import { createContext as createUnctx } from 'unctx';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Result, Ok, Err } from 'neverthrow';

// =================================================================
// Section 1: Core Type Definitions
// =================================================================

/**
 * Base context that all contexts must extend.
 * This ensures type safety and provides the minimum required properties.
 */
export type BaseContext = {
  readonly scope: Scope;
};

/**
 * Utility type for merging two contexts safely.
 * Properties in B override properties in A.
 */
export type MergeContexts<A extends BaseContext, B extends Record<string, unknown>> = 
  Omit<A, keyof B> & B & { scope: Scope };

/**
 * Utility type for context with optional extensions.
 * Useful for contexts that may or may not have certain dependencies.
 */
export type WithOptionalContext<Base extends BaseContext, Extension extends Record<string, unknown>> = 
  Base & Partial<Extension>;

/**
 * Type for context validation functions.
 */
export type ContextValidator<T> = (value: unknown) => value is T;

/**
 * Schema definition for runtime context validation.
 */
export type ContextSchema<T extends BaseContext> = {
  readonly [K in keyof Omit<T, 'scope'>]: ContextValidator<T[K]>;
};

/**
 * Error thrown when context validation fails.
 */
export class ContextValidationError extends Error {
  public readonly _tag = 'ContextValidationError' as const;

  constructor(
    public readonly field: string,
    public readonly expectedType: string,
    public readonly actualValue: unknown
  ) {
    super(`Context validation failed for field '${field}': expected ${expectedType}, got ${typeof actualValue}`);
    this.name = 'ContextValidationError';
    Object.setPrototypeOf(this, ContextValidationError.prototype);
  }
}

/**
 * Represents the execution scope for managing cancellation and cleanup.
 * The scope provides a unified way to handle cancellation across all tasks
 * in a workflow. When the signal is aborted, all tasks should gracefully
 * terminate their operations.
 */
export interface Scope {
  /**
   * An AbortSignal that is triggered if the entire `run` operation is cancelled.
   * All tasks within the scope should respect this signal.
   *
   * @example
   * ```typescript
   * const { scope } = getContext();
   * const response = await fetch(url, { signal: scope.signal });
   * ```
   */
  readonly signal: AbortSignal;
}

/**
 * Logger interface for workflow execution logging.
 * Compatible with common logging libraries like winston, pino, console, etc.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/**
 * A no-op logger that discards all log messages.
 */
export const noopLogger: Logger = {
  debug: () => { },
  info: () => { },
  warn: () => { },
  error: () => { },
};

/**
 * The fundamental unit of work in the library.
 *
 * A Task is an async function that receives a context and an input value,
 * and returns a Promise of an output value. Tasks are composable and can
 * be chained together using a `createWorkflow` function from the `utils` module.
 *
 * @template C The shape of the application's context (must extend BaseContext).
 * @template V The input value type for the task.
 * @template R The resolved output value type of the task.
 */
export type Task<C extends BaseContext, V, R> = ((context: C, value: V) => Promise<R>) & {
  /**
   * Internal property used to identify tasks for backtracking.
   * This is automatically set by `defineTask` and should not be manually modified.
   * @internal
   */
  __task_id?: symbol;

  /**
   * Internal property used by the `createWorkflow` utility to store the composed steps.
   * @internal
   */
  __steps?: ReadonlyArray<Task<C, unknown, unknown>>;
};

/**
 * A special signal used for non-linear control flow.
 *
 * When a task throws this signal, the `run` function will catch it and restart
 * the workflow from the specified target task with a new input value.
 * This enables powerful patterns like state machines and conditional flow control.
 */
export class BacktrackSignal<C extends BaseContext = BaseContext, V = unknown> extends Error {
  public readonly _tag = 'BacktrackSignal' as const;

  constructor(
    public readonly target: Task<C, V, unknown>,
    public readonly value: V
  ) {
    super('Backtrack signal - this is not an error');
    this.name = 'BacktrackSignal';
    Object.setPrototypeOf(this, BacktrackSignal.prototype);
  }
}

/**
 * Type guard to check if an error is a BacktrackSignal.
 */
export function isBacktrackSignal(error: unknown): error is BacktrackSignal {
  return error instanceof BacktrackSignal && (error as any)._tag === 'BacktrackSignal';
}

/**
 * A structured error type for all workflow execution failures.
 */
export class WorkflowError extends Error {
  // @ts-ignore - TypeScript version doesn't recognize Error.cause as overridable
  public readonly cause?: unknown;
  public readonly taskName?: string;
  public readonly taskIndex?: number;

  constructor(
    message: string,
    cause?: unknown,
    taskName?: string,
    taskIndex?: number
  ) {
    super(message);
    this.name = 'WorkflowError';
    this.cause = cause;
    this.taskName = taskName;
    this.taskIndex = taskIndex;
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

/**
 * Options for the `run` function with default error-throwing behavior.
 */
export interface RunOptionsThrow<C extends BaseContext> {
  throw?: true;
  logger?: Logger;
  overrides?: Partial<Omit<C, 'scope'>>;
  parentSignal?: AbortSignal;
}

/**
 * Options for the `run` function with `Result` return type.
 */
export interface RunOptionsResult<C extends BaseContext> {
  throw: false;
  logger?: Logger;
  overrides?: Partial<Omit<C, 'scope'>>;
  parentSignal?: AbortSignal;
}

export type RunOptions<C extends BaseContext> = RunOptionsThrow<C> | RunOptionsResult<C>;

/**
 * Error thrown when `getContext` is called outside of a `run` execution.
 */
export class ContextNotFoundError extends Error {
  constructor() {
    super('Context not found. Make sure you are calling getContext() within a run() execution.');
    this.name = 'ContextNotFoundError';
  }
}

/**
 * The set of tools returned by `createContext` for working with the library.
 */
export interface ContextTools<C extends BaseContext> {
  run<V, R>(workflow: Task<C, V, R>, initialValue: V, options?: RunOptionsThrow<C>): Promise<R>;
  run<V, R>(workflow: Task<C, V, R>, initialValue: V, options: RunOptionsResult<C>): Promise<Result<R, WorkflowError>>;
  getContext: () => C;
  getContextSafe: () => Result<C, ContextNotFoundError>;
  getContextOrUndefined: () => C | undefined;
  defineTask: <V, R>(fn: (value: V) => Promise<R>) => Task<C, V, R>;

  /**
   * Executes a function within a temporarily extended or overridden context.
   * This is the primitive for scoped dependency injection and is especially
   * useful for testing or temporarily altering effect handlers.
   *
   * @param overrides An object with properties to merge into the current context.
   * @param fn The async function to execute within the new context.
   * @returns The result of the provided function.
   *
   * @example
   * ```typescript
   * test('myTask should use a mock dependency', async () => {
   *   const mockApi = { getUser: () => Promise.resolve({ id: 'mock-user' }) };
   *
   *   // `run` is called inside the `provide` block, where `api` is mocked.
   *   const result = await provide({ api: mockApi }, () => run(fetchUser, 'real-id'));
   *
   *   expect(result.id).toBe('mock-user');
   * });
   * ```
   */
  provide<R>(
    overrides: Partial<Omit<C, 'scope'>>,
    fn: () => Promise<R>
  ): Promise<R>;
}


// =================================================================
// Section 2: Global Context Functions and Task Definition
// =================================================================

let globalUnctx: ReturnType<typeof createUnctx> | null = null;
function getGlobalUnctx<C extends { scope: Scope }>(): ReturnType<typeof createUnctx<C>> {
  if (!globalUnctx) {
    globalUnctx = createUnctx({ asyncContext: true, AsyncLocalStorage });
  }
  return globalUnctx as ReturnType<typeof createUnctx<C>>;
}

/**
 * Retrieves the current context. Must be called within a `run` execution.
 * @throws {ContextNotFoundError} If called outside of a `run` execution.
 */
export function getContext<C extends BaseContext>(unctx?: ReturnType<typeof createUnctx<C>>): C {
  const instance = unctx || getGlobalUnctx<C>();
  const ctx = instance.use();
  if (!ctx) throw new ContextNotFoundError();
  return ctx;
}

/**
 * Retrieves the current context as a `Result` type, preventing throws.
 * @returns {Result<C, ContextNotFoundError>} `Ok` with context or `Err` if not found.
 */
export function getContextSafe<C extends BaseContext>(unctx?: ReturnType<typeof createUnctx<C>>): Result<C, ContextNotFoundError> {
  const instance = unctx || getGlobalUnctx<C>();
  const ctx = instance.use();
  if (!ctx) {
    return { isOk: () => false, isErr: () => true, error: new ContextNotFoundError() } as Err<C, ContextNotFoundError>;
  }
  return { isOk: () => true, isErr: () => false, value: ctx } as Ok<C, ContextNotFoundError>;
}

/**
 * Retrieves the current context or `undefined` if not found. Never throws.
 * @returns The context object or `undefined`.
 */
export function getContextOrUndefined<C extends BaseContext>(unctx?: ReturnType<typeof createUnctx<C>>): C | undefined {
  const instance = unctx || getGlobalUnctx<C>();
  return instance.use();
}

/**
 * Defines a function as a `Task`, providing it with type safety and an internal
 * identity for use with advanced features like backtracking.
 *
 * @param fn The core logic of the task, accepting a value and returning a promise.
 * @returns A `Task` function that can be used in a workflow.
 */
export function defineTask<C extends BaseContext, V, R>(
  fn: (value: V) => Promise<R>
): Task<C, V, R> {
  const taskFn = (context: C, value: V): Promise<R> => fn(value);
  Object.defineProperty(taskFn, 'name', { value: fn.name || 'anonymous', configurable: true });
  Object.defineProperty(taskFn, '__task_id', { value: Symbol(`task_${fn.name || 'anonymous'}`), configurable: true, enumerable: false, writable: false });
  return taskFn as Task<C, V, R>;
}

// =================================================================
// Section 2: Context Utility Functions
// =================================================================

/**
 * Validates a context object against a schema.
 * Returns a Result indicating success or failure with detailed error information.
 */
export function validateContext<C extends BaseContext>(
  schema: ContextSchema<C>,
  context: unknown
): Result<C, ContextValidationError> {
  if (!context || typeof context !== 'object') {
    return {
      isOk: () => false,
      isErr: () => true,
      error: new ContextValidationError('root', 'object', context)
    } as Err<C, ContextValidationError>;
  }

  const ctx = context as Record<string, unknown>;

  // Validate each field in the schema
  for (const [field, validator] of Object.entries(schema) as Array<[string, ContextValidator<unknown>]>) {
    const value = ctx[field];
    if (!validator(value)) {
      return {
        isOk: () => false,
        isErr: () => true,
        error: new ContextValidationError(field, 'valid type', value)
      } as Err<C, ContextValidationError>;
    }
  }

  return {
    isOk: () => true,
    isErr: () => false,
    value: context as C
  } as Ok<C, ContextValidationError>;
}

/**
 * Type-safe context merging function.
 * Combines two contexts, with properties in the second context taking precedence.
 */
export function mergeContexts<A extends BaseContext, B extends Record<string, unknown>>(
  contextA: A,
  contextB: B
): MergeContexts<A, B> {
  return {
    ...contextA,
    ...contextB,
    scope: contextA.scope // Always preserve the original scope
  } as MergeContexts<A, B>;
}

/**
 * Creates a context transformer function that can be used to modify contexts.
 */
export function createContextTransformer<C1 extends BaseContext, C2 extends BaseContext>(
  transformer: (ctx: C1) => Omit<C2, 'scope'>
): (ctx: C1) => C2 {
  return (ctx: C1): C2 => {
    const transformed = transformer(ctx);
    return {
      ...transformed,
      scope: ctx.scope // Always preserve the scope
    } as C2;
  };
}

/**
 * Type-safe context property accessor.
 * Provides compile-time safety when accessing context properties.
 */
export function useContextProperty<C extends BaseContext, K extends keyof C>(
  key: K
): C[K] {
  const context = getContext<C>();
  return context[key];
}

/**
 * Requires specific properties to be present in the context.
 * Throws a descriptive error if any required property is missing.
 */
export function requireContextProperties<C extends BaseContext>(
  ...requirements: (keyof C)[]
): C {
  const context = getContext<C>();
  const missing: string[] = [];

  for (const requirement of requirements) {
    if (!(requirement in context) || context[requirement as keyof C] === undefined) {
      missing.push(String(requirement));
    }
  }

  if (missing.length > 0) {
    throw new ContextValidationError(
      missing.join(', '),
      'defined properties',
      'undefined'
    );
  }

  return context;
}

/**
 * Creates a task that provides additional context to its child task.
 */
export function withContextEnhancement<C extends BaseContext, Enhancement extends Record<string, unknown>, V, R>(
  enhancement: Enhancement,
  task: Task<MergeContexts<C, Enhancement>, V, R>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const enhancedContext = mergeContexts(context, enhancement);
    return task(enhancedContext, value);
  };
}

// =================================================================
// Section 3: Dependency Injection and Provider Patterns
// =================================================================

/**
 * Token for dependency injection.
 * A unique symbol used to identify injectable services.
 */
export type InjectionToken<T> = symbol & { __type?: T };

/**
 * Creates a new injection token with type information.
 */
export function createInjectionToken<T>(description: string): InjectionToken<T> {
  return Symbol(description) as InjectionToken<T>;
}

/**
 * Injectable service configuration.
 */
export interface Injectable<T> {
  provide: InjectionToken<T>;
  useValue?: T;
  useFactory?: () => T | Promise<T>;
}

/**
 * Context provider configuration.
 */
export interface ContextProvider<T> {
  provide: InjectionToken<T>;
  value: T;
}

/**
 * Injects a dependency from the current context using its token.
 * Throws an error if the dependency is not found.
 */
export function inject<T>(token: InjectionToken<T>): T {
  const context = getContext<BaseContext & Record<symbol, unknown>>();
  const value = context[token as symbol];
  
  if (value === undefined) {
    throw new Error(`Injection token ${token.toString()} not found in context`);
  }
  
  return value as T;
}

/**
 * Safely injects a dependency, returning undefined if not found.
 */
export function injectOptional<T>(token: InjectionToken<T>): T | undefined {
  try {
    return inject(token);
  } catch {
    return undefined;
  }
}

/**
 * Creates a context provider that supplies a value for a specific token.
 */
export function createContextProvider<T>(
  token: InjectionToken<T>
): {
  Provider: <C extends BaseContext, V, R>(
    value: T,
    task: Task<C & Record<symbol, T>, V, R>
  ) => Task<C, V, R>;
  useValue: () => T;
} {
  const Provider = <C extends BaseContext, V, R>(
    value: T,
    task: Task<C & Record<symbol, T>, V, R>
  ): Task<C, V, R> => {
    return async (context: C, input: V): Promise<R> => {
      const enhancedContext = {
        ...context,
        [token]: value
      } as C & Record<symbol, T>;
      
      return task(enhancedContext, input);
    };
  };

  const useValue = (): T => inject(token);

  return { Provider, useValue };
}

/**
 * Creates a scoped context that temporarily provides additional services.
 */
export function withScope<C extends BaseContext, V, R>(
  providers: ContextProvider<unknown>[],
  task: Task<C, V, R>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    let enhancedContext = { ...context };
    
    for (const provider of providers) {
      enhancedContext = {
        ...enhancedContext,
        [provider.provide]: provider.value
      };
    }
    
    return task(enhancedContext as C, value);
  };
}

/**
 * Higher-order function that creates a task with pre-configured dependencies.
 */
export function withDependencies<C extends BaseContext, Deps extends Record<string, unknown>>(
  dependencies: Deps
) {
  return function configureDependencies<V, R>(
    taskFactory: (deps: Deps) => Task<C, V, R>
  ): Task<C, V, R> {
    const task = taskFactory(dependencies);
    return task;
  };
}

/**
 * Creates a lazy-loaded dependency that is only instantiated when first accessed.
 */
export function createLazyDependency<T>(
  factory: () => T | Promise<T>
): () => Promise<T> {
  let instance: T | undefined;
  let loading: Promise<T> | undefined;

  return async (): Promise<T> => {
    if (instance !== undefined) {
      return instance;
    }

    if (loading) {
      return loading;
    }

    loading = Promise.resolve(factory()).then(result => {
      instance = result;
      loading = undefined;
      return result;
    });

    return loading;
  };
}


// =================================================================
// Section 4: The `createContext` Factory and `run` Engine
// =================================================================

/**
 * Creates a new, isolated system for running workflows.
 *
 * This factory function sets up the infrastructure for context propagation
 * and workflow execution. It returns all the core functions needed to define,
 * run, and test tasks within this isolated system.
 *
 * @param defaultContext The default values for your context.
 * @returns An object containing `run`, `getContext`, `defineTask`, and `provide`.
 */
export function createContext<C extends BaseContext>(
  defaultContext: Omit<C, 'scope'>
): ContextTools<C> {
  const unctx = createUnctx<C>({ asyncContext: true, AsyncLocalStorage });

  const getContext = (): C => {
    const ctx = unctx.use();
    if (!ctx) throw new ContextNotFoundError();
    return ctx;
  };

  const getContextSafe = (): Result<C, ContextNotFoundError> => {
    const ctx = unctx.use();
    if (!ctx) {
      return { isOk: () => false, isErr: () => true, error: new ContextNotFoundError() } as Err<C, ContextNotFoundError>;
    }
    return { isOk: () => true, isErr: () => false, value: ctx } as Ok<C, ContextNotFoundError>;
  };

  const getContextOrUndefined = (): C | undefined => {
    return unctx.use();
  };

  /**
   * Executes a function within a temporarily extended or overridden context.
   */
  async function provide<R>(
    overrides: Partial<Omit<C, 'scope'>>,
    fn: () => Promise<R>
  ): Promise<R> {
    const parentContext = getContext();
    // Inherit the parent scope to ensure cancellation propagates correctly.
    const newContext: C = {
      ...parentContext,
      ...overrides,
      scope: parentContext.scope,
    };
    return unctx.callAsync(newContext, fn);
  }

  /**
   * The internal implementation of the run engine.
   */
  async function runImpl<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options: RunOptions<C> = {}
  ): Promise<Result<R, WorkflowError>> {
    const { overrides, parentSignal, logger = noopLogger } = options;
    logger.debug(`Starting workflow: ${workflow.name || 'anonymous'}`);
    const controller = new AbortController();

    const onParentAbort = () => {
      if (!controller.signal.aborted) {
        logger.debug('Parent signal aborted, aborting workflow');
        controller.abort(parentSignal?.reason);
      }
    };
    if (parentSignal) {
      if (parentSignal.aborted) controller.abort(parentSignal.reason);
      else parentSignal.addEventListener('abort', onParentAbort, { once: true });
    }

    const executionContext: C = { ...defaultContext, ...(overrides as Partial<C>), scope: { signal: controller.signal } } as C;
    const allSteps = (workflow as any).__steps || [workflow];
    let currentIndex = 0;
    let currentValue: any = initialValue;

    try {
      while (currentIndex < allSteps.length) {
        if (controller.signal.aborted) {
          throw new WorkflowError('Workflow aborted', controller.signal.reason, allSteps[currentIndex]?.name, currentIndex);
        }
        try {
          const currentTask = allSteps[currentIndex];
          logger.debug(`Executing task ${currentIndex}: ${currentTask.name || 'anonymous'}`);
          currentValue = await unctx.callAsync(executionContext, () => currentTask(executionContext, currentValue));
          logger.debug(`Task ${currentIndex} completed successfully`);
          currentIndex++;
        } catch (error) {
          if (isBacktrackSignal(error)) {
            const targetIndex = allSteps.findIndex((step: { __task_id: symbol | undefined; }) => step.__task_id === error.target.__task_id);
            if (targetIndex === -1) throw new WorkflowError(`BacktrackSignal target "${error.target.name || 'anonymous'}" not found in workflow.`, error);
            if (targetIndex > currentIndex) throw new WorkflowError(`Cannot backtrack forward to task at index ${targetIndex}.`, error);
            logger.info(`Backtracking from step ${currentIndex} to ${targetIndex}`);
            currentIndex = targetIndex;
            currentValue = error.value;
            continue; // Continue the while loop from the new index
          }
          // For regular task failures, wrap in a WorkflowError and re-throw to be caught by the outer block.
          throw new WorkflowError(`Task failed: ${error instanceof Error ? error.message : String(error)}`, error, allSteps[currentIndex].name, currentIndex);
        }
      }
      logger.debug('Workflow completed successfully');
      return { isOk: () => true, isErr: () => false, value: currentValue as R } as Ok<R, WorkflowError>;
    } catch (error) {
      const workflowError = error instanceof WorkflowError ? error : new WorkflowError('An unhandled error occurred in the workflow', error);
      logger.error(workflowError.message, workflowError);
      if (!controller.signal.aborted) controller.abort(workflowError);
      return { isOk: () => false, isErr: () => true, error: workflowError } as Err<R, WorkflowError>;
    } finally {
      if (parentSignal) parentSignal.removeEventListener('abort', onParentAbort);
      if (!controller.signal.aborted) controller.abort();
    }
  }

  /**
   * The public-facing run function with overloads for error handling style.
   */
  function run<V, R>(workflow: Task<C, V, R>, initialValue: V, options?: RunOptionsThrow<C>): Promise<R>;
  function run<V, R>(workflow: Task<C, V, R>, initialValue: V, options: RunOptionsResult<C>): Promise<Result<R, WorkflowError>>;
  async function run<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options: RunOptions<C> = {}
  ): Promise<R | Result<R, WorkflowError>> {
    const result = await runImpl(workflow, initialValue, options);
    const shouldThrow = !('throw' in options) || options.throw !== false;
    if (shouldThrow) {
      if (result.isErr()) throw result.error;
      return result.value;
    }
    return result;
  }

  return { run, getContext, getContextSafe, getContextOrUndefined, defineTask, provide };
}