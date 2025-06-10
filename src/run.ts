import { createContext as createUnctx } from 'unctx';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Result, Ok, Err } from 'neverthrow';

// =================================================================
// Section 1: Core Type Definitions
// =================================================================

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
  debug(message: string, ...args: any[]): void;
  info(message: string, ...args: any[]): void;
  warn(message: string, ...args: any[]): void;
  error(message: string, ...args: any[]): void;
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
 * @template C The shape of the application's context.
 * @template V The input value type for the task.
 * @template R The resolved output value type of the task.
 */
export type Task<C, V, R> = ((context: C, value: V) => Promise<R>) & {
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
  __steps?: ReadonlyArray<Task<C, any, any>>;
};

/**
 * A special signal used for non-linear control flow.
 *
 * When a task throws this signal, the `run` function will catch it and restart
 * the workflow from the specified target task with a new input value.
 * This enables powerful patterns like state machines and conditional flow control.
 */
export class BacktrackSignal<V = any> extends Error {
  public readonly _tag = 'BacktrackSignal' as const;

  constructor(
    public readonly target: Task<any, any, any>,
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
  constructor(
    message: string,
    public override readonly cause?: unknown,
    public readonly taskName?: string,
    public readonly taskIndex?: number
  ) {
    super(message);
    this.name = 'WorkflowError';
    Object.setPrototypeOf(this, WorkflowError.prototype);
  }
}

/**
 * Options for the `run` function with default error-throwing behavior.
 */
export interface RunOptionsThrow<C extends { scope: Scope }> {
  throw?: true;
  logger?: Logger;
  overrides?: Partial<Omit<C, 'scope'>>;
  parentSignal?: AbortSignal;
}

/**
 * Options for the `run` function with `Result` return type.
 */
export interface RunOptionsResult<C extends { scope: Scope }> {
  throw: false;
  logger?: Logger;
  overrides?: Partial<Omit<C, 'scope'>>;
  parentSignal?: AbortSignal;
}

export type RunOptions<C extends { scope: Scope }> = RunOptionsThrow<C> | RunOptionsResult<C>;

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
export interface ContextTools<C extends { scope: Scope }> {
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
export function getContext<C extends { scope: Scope }>(unctx?: ReturnType<typeof createUnctx<C>>): C {
  const instance = unctx || getGlobalUnctx<C>();
  const ctx = instance.use();
  if (!ctx) throw new ContextNotFoundError();
  return ctx;
}

/**
 * Retrieves the current context as a `Result` type, preventing throws.
 * @returns {Result<C, ContextNotFoundError>} `Ok` with context or `Err` if not found.
 */
export function getContextSafe<C extends { scope: Scope }>(unctx?: ReturnType<typeof createUnctx<C>>): Result<C, ContextNotFoundError> {
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
export function getContextOrUndefined<C extends { scope: Scope }>(unctx?: ReturnType<typeof createUnctx<C>>): C | undefined {
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
export function defineTask<C extends { scope: Scope }, V, R>(
  fn: (value: V) => Promise<R>
): Task<C, V, R> {
  const taskFn = (context: C, value: V): Promise<R> => fn(value);
  Object.defineProperty(taskFn, 'name', { value: fn.name || 'anonymous', configurable: true });
  Object.defineProperty(taskFn, '__task_id', { value: Symbol(`task_${fn.name || 'anonymous'}`), configurable: true, enumerable: false, writable: false });
  return taskFn as Task<C, V, R>;
}


// =================================================================
// Section 3: The `createContext` Factory and `run` Engine
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
export function createContext<C extends { scope: Scope }>(
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