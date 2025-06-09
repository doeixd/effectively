import { createContext as createUnctx } from 'unctx';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Result, Ok, Err } from 'neverthrow';

// --- Type Definitions ---

/**
 * Represents the execution scope for managing cancellation and cleanup.
 * 
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
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * The fundamental unit of work in Effectively.
 * 
 * A Task is an async function that receives a context and an input value,
 * and returns a Promise of an output value. Tasks are composable and can
 * be chained together using the `pipe` function.
 * 
 * @template C The shape of the application's context
 * @template V The input value type for the task
 * @template R The resolved output value type of the task
 * 
 * @example
 * ```typescript
 * const fetchUser: Task<AppContext, string, User> = async (context, userId) => {
 *   const { api } = context;
 *   return api.users.getById(userId);
 * };
 * ```
 */
export type Task<C, V, R> = ((context: C, value: V) => Promise<R>) & {
  /**
   * Internal property used to identify tasks for backtracking.
   * This is automatically set by `defineTask` and should not be manually modified.
   * @internal
   */
  __task_id?: symbol;
  
  /**
   * Internal property used by pipe to store the composed steps.
   * @internal
   */
  __steps?: ReadonlyArray<Task<C, any, any>>;
};

/**
 * A special signal used for non-linear control flow.
 * 
 * When a task throws this signal, the `run` function will catch it and restart
 * the workflow from the specified target task with a new input value.
 * This enables powerful patterns like retry logic, state machines, and
 * conditional flow control.
 * 
 * @example
 * ```typescript
 * const validateUser = defineTask(async (user: User) => {
 *   if (!user.isValid) {
 *     // Backtrack to fetchUser with a different ID
 *     throw new BacktrackSignal(fetchUser, 'default-user-id');
 *   }
 *   return user;
 * });
 * ```
 */
export class BacktrackSignal<V = any> extends Error {
  public readonly _tag = 'BacktrackSignal' as const;
  
  /**
   * Creates a new BacktrackSignal.
   * 
   * @param target The specific Task function to backtrack to. Must be a task
   *               that was previously executed in the current workflow.
   * @param value The new initial value to start the target task with.
   */
  constructor(
    public readonly target: Task<any, any, any>,
    public readonly value: V
  ) {
    super('Backtrack signal - this is not an error');
    this.name = 'BacktrackSignal';
    
    // Ensure proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, BacktrackSignal.prototype);
  }
}

/**
 * Type guard to check if an error is a BacktrackSignal.
 * 
 * @param error The error to check
 * @returns True if the error is a BacktrackSignal
 */
export function isBacktrackSignal(error: unknown): error is BacktrackSignal {
  return error instanceof BacktrackSignal && (error as any)._tag === 'BacktrackSignal';
}

/**
 * Error type for workflow execution failures.
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
 * Options for the `run` function with throw behavior (default).
 * 
 * @template C The context type
 */
export interface RunOptionsThrow<C extends { scope: Scope }> {
  /**
   * Whether to throw errors or return a Result type.
   * @default true
   */
  throw?: true;
  
  /**
   * Logger instance for debugging workflow execution.
   * @default noopLogger
   */
  logger?: Logger;
  
  /**
   * An optional object to override default context properties for this
   * specific run. This is the primary mechanism for dependency injection.
   */
  overrides?: Partial<Omit<C, 'scope'>>;
  
  /**
   * An optional external AbortSignal to link the workflow's cancellation to,
   * such as from an HTTP server request.
   */
  parentSignal?: AbortSignal;
}

/**
 * Options for the `run` function with Result return type.
 * 
 * @template C The context type
 */
export interface RunOptionsResult<C extends { scope: Scope }> {
  /**
   * Whether to throw errors or return a Result type.
   * Must be explicitly set to false to get Result return type.
   */
  throw: false;
  
  /**
   * Logger instance for debugging workflow execution.
   * @default noopLogger
   */
  logger?: Logger;
  
  /**
   * An optional object to override default context properties for this
   * specific run. This is the primary mechanism for dependency injection.
   */
  overrides?: Partial<Omit<C, 'scope'>>;
  
  /**
   * An optional external AbortSignal to link the workflow's cancellation to,
   * such as from an HTTP server request.
   */
  parentSignal?: AbortSignal;
}

/**
 * Combined run options type.
 */
export type RunOptions<C extends { scope: Scope }> = 
  | RunOptionsThrow<C> 
  | RunOptionsResult<C>;

/**
 * Error thrown when context is not found.
 */
export class ContextNotFoundError extends Error {
  constructor() {
    super('Context not found. Make sure you are calling getContext() within a run() execution.');
    this.name = 'ContextNotFoundError';
    Object.setPrototypeOf(this, ContextNotFoundError.prototype);
  }
}

/**
 * The result of calling `createContext`, containing all the tools needed
 * to work with the Effectively context system.
 * 
 * @template C The context type
 */
export interface ContextTools<C extends { scope: Scope }> {
  /**
   * Executes an Effectively workflow with the provided context.
   * 
   * @overload When throw is true or undefined (default)
   */
  run<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options?: RunOptionsThrow<C>
  ): Promise<R>;
  
  /**
   * Executes an Effectively workflow with the provided context.
   * 
   * @overload When throw is false
   */
  run<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options: RunOptionsResult<C>
  ): Promise<Result<R, WorkflowError>>;
  
  /**
   * Retrieves the current context. Must be called within a `run` execution.
   * Throws if context is not found.
   */
  getContext: () => C;
  
  /**
   * Retrieves the current context as a Result type.
   * Returns an Err if context is not found instead of throwing.
   */
  getContextSafe: () => Result<C, ContextNotFoundError>;
  
  /**
   * Retrieves the current context or undefined if not found.
   * Never throws.
   */
  getContextOrUndefined: () => C | undefined;
  
  /**
   * Defines a new task with proper typing and backtracking support.
   */
  defineTask: <V, R>(fn: (value: V) => Promise<R>) => Task<C, V, R>;
}

// --- Global Context Functions ---

/**
 * Internal unctx instance for global usage.
 * This is created lazily when first needed.
 */
let globalUnctx: ReturnType<typeof createUnctx> | null = null;

/**
 * Gets or creates the global unctx instance.
 * @internal
 */
function getGlobalUnctx<C extends { scope: Scope }>(): ReturnType<typeof createUnctx<C>> {
  if (!globalUnctx) {
    globalUnctx = createUnctx({
      asyncContext: true,
      AsyncLocalStorage,
    });
  }
  return globalUnctx as ReturnType<typeof createUnctx<C>>;
}

/**
 * Retrieves the current context. Must be called within a `run` execution.
 * 
 * @template C The context type (must include scope: Scope)
 * @param unctx Optional unctx instance. If not provided, uses a shared global instance.
 * @throws {ContextNotFoundError} If called outside of a run() execution
 * 
 * @example
 * ```typescript
 * import { getContext } from 'effectively';
 * 
 * interface MyContext {
 *   scope: Scope;
 *   api: ApiClient;
 * }
 * 
 * const task = async (value: string) => {
 *   const { api } = getContext<MyContext>();
 *   return api.fetch(value);
 * };
 * ```
 */
export function getContext<C extends { scope: Scope }>(
  unctx?: ReturnType<typeof createUnctx<C>>
): C {
  const instance = unctx || getGlobalUnctx<C>();
  const ctx = instance.use();
  if (!ctx) {
    throw new ContextNotFoundError();
  }
  return ctx;
}

/**
 * Retrieves the current context as a Result type.
 * 
 * @template C The context type (must include scope: Scope)
 * @param unctx Optional unctx instance. If not provided, uses a shared global instance.
 * @returns {Result<C, ContextNotFoundError>} Ok with context or Err if not in context
 * 
 * @example
 * ```typescript
 * import { getContextSafe } from 'effectively';
 * 
 * const result = getContextSafe<MyContext>();
 * if (result.isOk()) {
 *   const { api } = result.value;
 * }
 * ```
 */
export function getContextSafe<C extends { scope: Scope }>(
  unctx?: ReturnType<typeof createUnctx<C>>
): Result<C, ContextNotFoundError> {
  const instance = unctx || getGlobalUnctx<C>();
  const ctx = instance.use();
  if (!ctx) {
    return { 
      isOk: () => false, 
      isErr: () => true, 
      error: new ContextNotFoundError() 
    } as Err<C, ContextNotFoundError>;
  }
  return { 
    isOk: () => true, 
    isErr: () => false, 
    value: ctx 
  } as Ok<C, ContextNotFoundError>;
}

/**
 * Retrieves the current context or undefined if not found.
 * 
 * @template C The context type (must include scope: Scope)
 * @param unctx Optional unctx instance. If not provided, uses a shared global instance.
 * @returns {C | undefined} The context or undefined if not in context
 * 
 * @example
 * ```typescript
 * import { getContextOrUndefined } from 'effectively';
 * 
 * const context = getContextOrUndefined<MyContext>();
 * const api = context?.api;
 * ```
 */
export function getContextOrUndefined<C extends { scope: Scope }>(
  unctx?: ReturnType<typeof createUnctx<C>>
): C | undefined {
  const instance = unctx || getGlobalUnctx<C>();
  return instance.use();
}

/**
 * Defines and type-constrains a function as a `Task`.
 * 
 * @template C The context type (must include scope: Scope)
 * @template V The input value type
 * @template R The return value type
 * @param fn The task function
 * @returns A Task with proper typing and backtracking support
 * 
 * @example
 * ```typescript
 * import { defineTask, getContext } from 'effectively';
 * 
 * interface MyContext {
 *   scope: Scope;
 *   api: ApiClient;
 * }
 * 
 * const fetchUser = defineTask<MyContext, string, User>(
 *   async (userId) => {
 *     const { api } = getContext<MyContext>();
 *     return api.users.getById(userId);
 *   }
 * );
 * ```
 */
export function defineTask<C extends { scope: Scope }, V, R>(
  fn: (value: V) => Promise<R>
): Task<C, V, R> {
  // Create the Task function wrapper
  const taskFn = async (context: C, value: V): Promise<R> => {
    // The context is made available via unctx.callAsync in run()
    // The task implementation accesses it via getContext()
    return fn(value);
  };

  // Copy over function properties for better debugging
  Object.defineProperty(taskFn, 'name', {
    value: fn.name || 'anonymous',
    configurable: true,
  });

  // Attach the unique identifier for backtracking
  Object.defineProperty(taskFn, '__task_id', {
    value: Symbol(`task_${fn.name || 'anonymous'}`),
    configurable: true,
    enumerable: false,
    writable: false,
  });

  return taskFn as Task<C, V, R>;
}

/**
 * Creates a new Effectively context system.
 * 
 * This factory function sets up the infrastructure for context propagation
 * and workflow execution. It returns the core functions needed to define
 * and run tasks within the context system.
 * 
 * @template C The shape of your application's context. Must include a `scope` property.
 * @param defaultContext The default values for your context (excluding `scope`,
 *                       which is automatically managed).
 * @returns An object containing `run`, `getContext`, and `defineTask` functions
 * 
 * @example
 * ```typescript
 * interface AppContext {
 *   scope: Scope;
 *   api: ApiClient;
 *   logger: Logger;
 * }
 * 
 * const { run, getContext, getContextSafe, getContextOrUndefined, defineTask } = createContext<AppContext>({
 *   api: new ApiClient(),
 *   logger: new Logger()
 * });
 * 
 * // Using getContext (throws if not in context)
 * const fetchUser = defineTask(async (userId: string) => {
 *   const { api } = getContext();
 *   return api.users.getById(userId);
 * });
 * 
 * // Using getContextSafe (returns Result)
 * const fetchUserSafe = defineTask(async (userId: string) => {
 *   const contextResult = getContextSafe();
 *   if (contextResult.isErr()) {
 *     throw new Error('Not in a valid context');
 *   }
 *   const { api } = contextResult.value;
 *   return api.users.getById(userId);
 * });
 * 
 * // Using getContextOrUndefined (returns C | undefined)
 * const fetchUserOptional = defineTask(async (userId: string) => {
 *   const context = getContextOrUndefined();
 *   if (!context) {
 *     return null; // or handle gracefully
 *   }
 *   const { api } = context;
 *   return api.users.getById(userId);
 * });
 * 
 * // Using with error throwing (default)
 * const user = await run(fetchUserWorkflow, 'user-123');
 * 
 * // Using with Result type
 * const result = await run(fetchUserWorkflow, 'user-123', { throw: false });
 * if (result.isOk()) {
 *   console.log('User:', result.value);
 * } else {
 *   console.error('Error:', result.error);
 * }
 * ```
 */
export function createContext<C extends { scope: Scope }>(
  defaultContext: Omit<C, 'scope'>
): ContextTools<C> {
  // Create the unctx instance with AsyncLocalStorage for robust context propagation
  const unctx = createUnctx<C>({
    asyncContext: true,
    AsyncLocalStorage,
  });

  // Re-export the context hook
  const getContext = (): C => {
    const ctx = unctx.use();
    if (!ctx) {
      throw new ContextNotFoundError();
    }
    return ctx;
  };

  // Safe version that returns a Result
  const getContextSafe = (): Result<C, ContextNotFoundError> => {
    const ctx = unctx.use();
    if (!ctx) {
      return { 
        isOk: () => false, 
        isErr: () => true, 
        error: new ContextNotFoundError() 
      } as Err<C, ContextNotFoundError>;
    }
    return { 
      isOk: () => true, 
      isErr: () => false, 
      value: ctx 
    } as Ok<C, ContextNotFoundError>;
  };

  // Version that returns undefined instead of throwing
  const getContextOrUndefined = (): C | undefined => {
    return unctx.use();
  };

  /**
   * Internal implementation of run that always returns a Result.
   */
  async function runImpl<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options: RunOptions<C> = {}
  ): Promise<Result<R, WorkflowError>> {
    const { overrides, parentSignal, logger = noopLogger } = options;
    
    logger.debug(`Starting workflow: ${workflow.name || 'anonymous'}`);
    
    // Set up the AbortController for this run's scope
    const controller = new AbortController();
    
    // Link to parent signal if provided
    const onParentAbort = () => {
      if (!controller.signal.aborted) {
        logger.debug('Parent signal aborted, aborting workflow');
        controller.abort(parentSignal?.reason);
      }
    };
    
    if (parentSignal) {
      if (parentSignal.aborted) {
        // If already aborted, abort immediately
        controller.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener('abort', onParentAbort, { once: true });
      }
    }

    // Construct the full context for this execution
    const executionContext: C = {
      ...defaultContext,
      ...(overrides as Partial<C>),
      scope: { signal: controller.signal },
    } as C;

    // Extract the individual steps from the workflow
    const allSteps = (workflow as any).__steps || [workflow];
    let currentIndex = 0;
    let currentValue: any = initialValue;

    try {
      while (currentIndex < allSteps.length) {
        // Check if we've been aborted before starting each task
        if (controller.signal.aborted) {
          const error = new WorkflowError(
            'Workflow aborted',
            controller.signal.reason,
            allSteps[currentIndex].name,
            currentIndex
          );
          logger.error('Workflow aborted', error);
          return { isOk: () => false, isErr: () => true, error } as Err<R, WorkflowError>;
        }

        try {
          const currentTask = allSteps[currentIndex];
          logger.debug(`Executing task ${currentIndex}: ${currentTask.name || 'anonymous'}`);
          
          // Execute the current step within the context
          const result = await unctx.callAsync(executionContext, async () => {
            return currentTask(executionContext, currentValue);
          });

          logger.debug(`Task ${currentIndex} completed successfully`);
          
          // Move to the next step
          currentValue = result;
          currentIndex++;
        } catch (error) {
          // Handle Backtracking Signal
          if (isBacktrackSignal(error)) {
            // Find the index of the task we need to backtrack to
            const targetIndex = allSteps.findIndex(
              (step: Task<any, any, any>) => step.__task_id === error.target.__task_id
            );
            
            if (targetIndex === -1) {
              const workflowError = new WorkflowError(
                `BacktrackSignal target "${error.target.name || 'anonymous'}" was not found in the current workflow. ` +
                'Make sure the target task is part of the workflow and was defined using defineTask().',
                error,
                allSteps[currentIndex].name,
                currentIndex
              );
              logger.error('Backtrack target not found', workflowError);
              return { isOk: () => false, isErr: () => true, error: workflowError } as Err<R, WorkflowError>;
            }
            
            if (targetIndex > currentIndex) {
              const workflowError = new WorkflowError(
                `Cannot backtrack forward: target task at index ${targetIndex} comes after current task at index ${currentIndex}. ` +
                'Backtracking can only go to previously executed tasks.',
                error,
                allSteps[currentIndex].name,
                currentIndex
              );
              logger.error('Invalid backtrack direction', workflowError);
              return { isOk: () => false, isErr: () => true, error: workflowError } as Err<R, WorkflowError>;
            }
            
            logger.info(
              `Backtracking from step ${currentIndex} (${allSteps[currentIndex].name || 'anonymous'}) ` +
              `to step ${targetIndex} (${allSteps[targetIndex].name || 'anonymous'})`
            );
            
            // Set the index and the new starting value for the target task
            currentIndex = targetIndex;
            currentValue = error.value;
            continue;
          }

          // For all other errors, create a WorkflowError
          const workflowError = new WorkflowError(
            `Task failed: ${error instanceof Error ? error.message : String(error)}`,
            error,
            allSteps[currentIndex].name,
            currentIndex
          );
          logger.error(`Task ${currentIndex} failed`, workflowError);
          
          if (!controller.signal.aborted) {
            controller.abort(error);
          }
          
          return { isOk: () => false, isErr: () => true, error: workflowError } as Err<R, WorkflowError>;
        }
      }

      // Workflow completed successfully
      logger.debug('Workflow completed successfully');
      return { isOk: () => true, isErr: () => false, value: currentValue as R } as Ok<R, WorkflowError>;
    } finally {
      // Cleanup
      if (parentSignal) {
        parentSignal.removeEventListener('abort', onParentAbort);
      }
      
      // Abort the controller if not already aborted (cleanup any remaining operations)
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }

  /**
   * The primary entry point for executing an Effectively workflow.
   *
   * This function establishes the root execution environment, creating the top-level
   * Scope and Context. It uses `unctx` (powered by `AsyncLocalStorage`) to make this
   * context available throughout the asynchronous call stack without manual prop-drilling.
   *
   * @example
   * ```typescript
   * // Basic execution (throws on error)
   * const result = await run(myWorkflow, 'start-id');
   * 
   * // With Result type (doesn't throw)
   * const result = await run(myWorkflow, 'start-id', { throw: false });
   * if (result.isOk()) {
   *   console.log('Success:', result.value);
   * } else {
   *   console.error('Error:', result.error);
   * }
   * 
   * // With logger and overrides
   * const result = await run(
   *   myWorkflow,
   *   'start-id',
   *   {
   *     logger: customLogger,
   *     overrides: { api: mockApi },
   *     parentSignal: controller.signal
   *   }
   * );
   * ```
   */
  function run<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options?: RunOptionsThrow<C>
  ): Promise<R>;
  function run<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options: RunOptionsResult<C>
  ): Promise<Result<R, WorkflowError>>;
  async function run<V, R>(
    workflow: Task<C, V, R>,
    initialValue: V,
    options: RunOptions<C> = {}
  ): Promise<R | Result<R, WorkflowError>> {
    const result = await runImpl(workflow, initialValue, options);
    
    // Type guard to check if we should throw
    const shouldThrow = !('throw' in options) || options.throw !== false;
    
    if (shouldThrow) {
      if (result.isErr()) {
        throw result.error;
      }
      return result.value;
    }
    
    return result;
  }

  return { run, getContext, getContextSafe, getContextOrUndefined, defineTask };
}