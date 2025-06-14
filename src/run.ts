import { createContext as createUnctx } from "unctx";
import { AsyncLocalStorage } from "node:async_hooks";
import { type Result, type Ok, type Err, ok, err } from "neverthrow";

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
export type MergeContexts<
  A extends BaseContext,
  B extends Record<string, unknown>,
> = Omit<A, keyof B> & B & { scope: Scope };

/**
 * Utility type for context with optional extensions.
 * Useful for contexts that may or may not have certain dependencies.
 */
export type WithOptionalContext<
  Base extends BaseContext,
  Extension extends Record<string, unknown>,
> = Base & Partial<Extension>;

/**
 * Type for context validation functions.
 */
export type ContextValidator<T> = (value: unknown) => value is T;

/**
 * Schema definition for runtime context validation.
 */
export type ContextSchema<T extends BaseContext> = {
  readonly [K in keyof Omit<T, "scope">]: ContextValidator<T[K]>;
};

/**
 * Error thrown when context validation fails.
 */
export class ContextValidationError extends Error {
  public readonly _tag = "ContextValidationError" as const;
  public readonly field: string;
  public readonly expectedType: string;
  public readonly actualValue: unknown;

  constructor(field: string, expectedType: string, actualValue: unknown) {
    super(
      `Context validation failed for field '${field}': expected ${expectedType}, got ${typeof actualValue}`,
    );
    this.name = "ContextValidationError";
    this.field = field;
    this.expectedType = expectedType;
    this.actualValue = actualValue;
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
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
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
export type Task<C extends BaseContext, V, R> = ((
  context: C,
  value: V,
) => Promise<R>) & {
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
export class BacktrackSignal<
  C extends BaseContext = BaseContext,
  V = unknown,
> extends Error {
  public readonly _tag = "BacktrackSignal" as const;
  public readonly target: Task<C, V, unknown>;
  public readonly value: V;

  constructor(target: Task<C, V, unknown>, value: V) {
    super("Backtrack signal - this is not an error");
    this.name = "BacktrackSignal";
    this.target = target;
    this.value = value;
    Object.setPrototypeOf(this, BacktrackSignal.prototype);
  }
}

/**
 * Type guard to check if an error is a BacktrackSignal.
 */
export function isBacktrackSignal(error: unknown): error is BacktrackSignal {
  return (
    error instanceof BacktrackSignal &&
    (error as any)._tag === "BacktrackSignal"
  );
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
    taskIndex?: number,
  ) {
    super(message);
    this.name = "WorkflowError";
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
  overrides?: Partial<Omit<C, "scope">>;
  parentSignal?: AbortSignal;
}

/**
 * Options for the `run` function with `Result` return type.
 */
export interface RunOptionsResult<C extends BaseContext> {
  throw: false;
  logger?: Logger;
  overrides?: Partial<Omit<C, "scope">>;
  parentSignal?: AbortSignal;
}

export type RunOptions<C extends BaseContext> =
  | RunOptionsThrow<C>
  | RunOptionsResult<C>;

/**
 * Error thrown when `getContext` is called outside of a `run` execution.
 */
export class ContextNotFoundError extends Error {
  constructor(message?: string) {
    super(
      message ||
        "Context not found. Make sure you are calling getContext() within a run() execution.",
    );
    this.name = "ContextNotFoundError";
  }
}

/**
 * The set of tools returned by `createContext<C>()` for working with
 * a specifically typed and isolated Effectively context.
 *
 * All methods within these tools operate on the context of type `C`
 * that was defined when `createContext<C>()` was called. They use an
 * internal `unctx` instance unique to this set of tools.
 *
 * @template C The specific `BaseContext` type this set of tools operates on.
 */
export interface ContextTools<
  C extends BaseContext,
  G extends BaseContext = DefaultGlobalContext,
> {
  /**
   * Executes a workflow (a Task or a chain of Tasks) within this specific context.
   *
   * @template V The input value type for the workflow.
   * @template R The result type of the workflow.
   *
   * @param workflow The `Task<C, V, R>` or a compatible task to execute.
   *                 If a `Task<any, V, R>` (from global `defineTask`) is passed,
   *                 it will run within this specific context `C`.
   * @param initialValue The initial input value for the first task.
   * @param options Optional `RunOptions<C>` to control error handling (`throw`),
   *                logging, context overrides specific to this run, and parent cancellation.
   *                Overrides are applied on top of the default context data for these tools.
   *
   * @returns A Promise that resolves to the workflow's final result `R`, or, if
   *          `options.throw` is `false`, a `Promise<Result<R, WorkflowError>>`.
   */
  run<V, R>(
    workflow: Task<C, V, R> | Task<any, V, R>, // Can run tasks defined globally or for this specific context
    initialValue: V,
    options?: RunOptionsThrow<C>,
  ): Promise<R>;
  run<V, R>(
    workflow: Task<C, V, R> | Task<any, V, R>,
    initialValue: V,
    options: RunOptionsResult<C>,
  ): Promise<Result<R, WorkflowError>>;

  /**
   * Retrieves the currently active context of type `C` for this specific
   * `ContextTools` instance.
   *
   * @returns The context object of type `C`.
   * @throws {ContextNotFoundError} If called outside of an active `run` or
   *         `provide` scope managed by *this specific set of tools*.
   */
  getContext: () => C;

  /**
   * Safely retrieves the currently active context of type `C` as a `Result`.
   *
   * @returns `Ok(context)` if the context is active, otherwise `Err(ContextNotFoundError)`.
   */
  getContextSafe: () => Result<C, ContextNotFoundError>;

  /**
   * Retrieves the currently active context of type `C`, or `undefined` if not
   * within an active scope of these tools.
   *
   * @returns The context object `C` or `undefined`.
   */
  getContextOrUndefined: () => C | undefined;

  /**
   * Defines a Task that is strongly typed to operate within context `C`.
   *
   * The provided function `fn` should use `this.getContext()` (or the `getContext`
   * destructured from these tools) to access the context `C`.
   *
   * @template V The input value type for the task's logic.
   * @template R The result type the task's logic will resolve to.
   *
   * @param fn The core asynchronous logic of the task.
   * @param taskNameOrOptions Optional name for the task or `DefineTaskOptions`.
   * @returns A `Task<C, V, R>`, strongly typed to this context.
   */
  defineTask: <V, R>(
    fn: (value: V) => Promise<R>,
    taskNameOrOptions?: string | DefineTaskOptions,
  ) => Task<C, V, R>;

  /**
   * Executes a function within a new, nested context scope that temporarily
   * includes the specified overrides. This new scope is managed by the same
   * `unctx` instance associated with these `ContextTools`.
   *
   * The `scope` property is always inherited from the parent context of this
   * `provide` call and cannot be overridden.
   *
   * @template Pr The result type of the function `fn`. (Using `Pr` to avoid conflict with `R` from `run`)
   *
   * @param overrides An object with properties to merge into (or override on)
   *                  the current context for the duration of `fn`'s execution.
   *                  Overrides are typed against `C`.
   * @param fn The asynchronous function to execute within the new, modified context.
   *           Calls to `this.getContext()` within this function will resolve to the new context.
   * @param options Optional `ProvideImplOptions` to specify the context merging
   *                strategy (e.g., 'spread' or 'proxy'). Defaults to 'spread'.
   *
   * @returns A Promise that resolves with the result of `fn`.
   *
   * @example
   * ```typescript
   * const { provide, run, defineTask, getContext } = createContext<MyContext>(...);
   *
   * const myInnerTask = defineTask(async () => {
   *   const ctx = getContext(); // Gets MyContext + { temporaryApi: ... }
   *   // ctx.temporaryApi.call();
   * });
   *
   * await provide(
   *   { temporaryApi: new MockApi() },
   *   async () => {
   *     // Code here runs with temporaryApi in context
   *     await run(myInnerTask, undefined);
   *   }
   * );
   * ```
   */
  provide<Pr>(
    overrides: Partial<
      Omit<C, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
        Record<string | symbol, any>
    >,
    fn: () => Promise<Pr>,
    options?: ProvideImplOptions, // Allow strategy selection
  ): Promise<Pr>;

  /**
   * Injects a dependency from the current context `C` using its token.
   *
   * @template T The type of the dependency to inject.
   * @param token The `InjectionToken<T>` for the dependency.
   * @returns The resolved dependency of type `T`.
   * @throws Error if the token is not found in the current context `C`.
   */
  inject<T>(token: InjectionToken<T>): T;

  /**
   * Safely injects a dependency from the current context `C`, returning
   * `undefined` if the token is not found.
   *
   * @template T The type of the dependency to inject.
   * @param token The `InjectionToken<T>` for the dependency.
   * @returns The resolved dependency of type `T`, or `undefined`.
   */
  injectOptional<T>(token: InjectionToken<T>): T | undefined;

  /**
   * Retrieves this toolset's specific context `C_Specific` if active,
   * otherwise falls back to the application's global context `G_AppGlobal`.
   */
  getContextOrGlobal: () => C | G;
}

// =================================================================
// Section 2: Global Context Functions and Task Definition
// =================================================================

/**
 * Symbol used to store the unctx instance on context objects for smart function detection
 */
const UNCTX_INSTANCE_SYMBOL = Symbol("__unctx_instance__");

let globalUnctx: ReturnType<typeof createUnctx> | null = null;
function getGlobalUnctx<C extends { scope: Scope }>(): ReturnType<
  typeof createUnctx<C>
> {
  if (!globalUnctx) {
    try {
      globalUnctx = createUnctx({ asyncContext: true, AsyncLocalStorage });
    } catch (error) {
      // Fallback to sync context if AsyncLocalStorage is not available
      globalUnctx = createUnctx({ asyncContext: false });
    }
  }
  return globalUnctx as ReturnType<typeof createUnctx<C>>;
}

let memoizedGlobalDefaultContextObject: DefaultGlobalContext | null = null;

function getGlobalDefaultContextObjectSingleton(): DefaultGlobalContext {
  if (!memoizedGlobalDefaultContextObject) {
    const controller = new AbortController();
    memoizedGlobalDefaultContextObject = {
      scope: { signal: controller.signal },
      // Any other essential, minimal global defaults
    } as DefaultGlobalContext;

    // Initialize the global unctx store with this default object ONCE.
    // This is crucial so that globalUnctx.use() can retrieve it.
    const globalUnctxInstance = getGlobalUnctx<DefaultGlobalContext>(); // Your existing function
    globalUnctxInstance
      .callAsync(memoizedGlobalDefaultContextObject, () => Promise.resolve())
      .catch((e) => {
        console.error(
          "[Effectively] Failed to initialize global unctx store with default object:",
          e,
        );
      });
  }
  return memoizedGlobalDefaultContextObject;
}

/**
 * Thread-local storage for tracking the current unctx instance
 */
let currentUnctxInstance: ReturnType<typeof createUnctx> | null = null;
// Setter for currentUnctxInstance - to be called by run/provide implementations
// THIS IS A CRITICAL PART OF THE SYSTEM.
// `run` and `provide` implementations MUST call this.
export function _INTERNAL_setCurrentUnctxInstance(
  instance: ReturnType<typeof createUnctx<any>> | null,
): void {
  currentUnctxInstance = instance;
}
// Getter for testing or very specific internal uses, not for general public API.
export function _INTERNAL_getCurrentUnctxInstance(): ReturnType<
  typeof createUnctx<any>
> | null {
  return currentUnctxInstance;
}

/**
 * Internal Helper: Retrieves the context object from the *currently active specific*
 * `unctx` instance, if one is set (via `currentUnctxInstance`).
 *
 * This function is used by "smart" global functions (like `getContext`, `run`, `provide`)
 * to detect if they are operating within a scope established by a specific
 * `createContext().run()` or `createContext().provide()` call.
 *
 * If `currentUnctxInstance` is `null`, it means no specific Effectively context's
 * `run` or `provide` is currently active up the async call stack, so this function
 * will return `undefined`.
 *
 * If `currentUnctxInstance` is set, it attempts to retrieve the context stored
 * by that `unctx` instance for the current asynchronous execution path.
 *
 * @template C The expected type of the context. This is an assertion by the caller.
 * @returns The active specific context object of type `C` if found and compatible,
 *          otherwise `undefined`.
 */
export function getContextOrUndefinedFromActiveInstance<
  C extends BaseContext,
>(): C | undefined {
  if (currentUnctxInstance) {
    try {
      // Attempt to use the currently set specific unctx instance.
      // `unctx.use()` retrieves the context object stored for the current async path
      // by this specific unctx instance. It might return `undefined` if, for example,
      // `callAsync` wasn't used correctly or if we're outside its scope despite
      // `currentUnctxInstance` being set (less common if managed properly).
      const ctx = currentUnctxInstance.use() as C | undefined; // Cast to C | undefined
      return ctx;
    } catch (error) {
      // This catch is a safeguard. `unctx.use()` typically returns undefined
      // or throws if the internal store is not initialized, rather than other errors.
      // Log this, as it might indicate an issue with `unctx` setup or `AsyncLocalStorage`.
      console.warn(
        "[Effectively Internal] Error calling 'use()' on currentUnctxInstance. " +
          "This might indicate an issue with AsyncLocalStorage or unctx setup. Returning undefined.",
        error,
      );
      return undefined;
    }
  }

  // No `currentUnctxInstance` is set, meaning we are not within a specific
  // `run` or `provide` scope established by `createContext().run/provide`.
  return undefined;
}

// =================================================================
// Section 2.1: Default Global Context System
// =================================================================

/**
 * Default context interface that can be used without explicit context creation
 */
interface DefaultGlobalContext extends BaseContext {}

const DEFAULT_GLOBAL_CONTEXT_KEY = "__effectively_default_context__" as const;

declare global {
  var __effectively_default_context__:
    | ContextTools<DefaultGlobalContext, DefaultGlobalContext>
    | undefined;
}

// =================================================================
// Section 2.2: Smart Default Context Functions
// =================================================================

export interface DefineTaskOptions {
  name?: string;
  idSymbol?: symbol;
}

/**
 * Internal helper to create the Task function object with metadata.
 * - ActualContext: The context type `run` will provide to this task's executor.
 * - ExpectedContextInFn: The context type `getContext<C>()` calls *inside* `fn` will expect.
 */
function createTaskFunction<
  V, // Input type of fn
  R, // Result type of fn
  ActualContext extends BaseContext, // Context type for the Task signature
  ExpectedContextInFn extends BaseContext, // Context type fn expects via getContext<ExpectedContextInFn>
>(
  fn: (value: V) => Promise<R>,
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<ActualContext, V, R> {
  const taskFnExecutor = (context: ActualContext, value: V): Promise<R> => {
    // The user's `fn` uses getContext<ExpectedContextInFn>() internally.
    // The `context` param here is what `run` provides.
    return fn(value);
  };

  let taskName: string | undefined;
  let idSymbol: symbol | undefined;

  if (typeof taskNameOrOptions === "string") {
    taskName = taskNameOrOptions;
  } else if (taskNameOrOptions) {
    taskName = taskNameOrOptions.name;
    idSymbol = taskNameOrOptions.idSymbol;
  }

  const finalName = taskName || fn.name || "anonymousTask";

  Object.defineProperty(taskFnExecutor, "name", {
    value: finalName,
    configurable: true,
  });
  Object.defineProperty(taskFnExecutor, "__task_id", {
    value: idSymbol || Symbol(finalName),
    configurable: false,
    enumerable: false,
    writable: false,
  });

  return taskFnExecutor as Task<ActualContext, V, R>;
}

/**
 * Defines a context-aware Task, inferring Input (V) and Result (R) types from `fn`.
 * The expected Context (C) for `getContext<C>()` calls within `fn` defaults to `DefaultGlobalContext`.
 * The returned Task is typed as `Task<any, V, R>`, suitable for global use.
 */
export function defineTask<V, R>(
  fn: (value: V) => Promise<R>,
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<any, V, R>;
/**
 * Defines a context-aware Task, specifying the expected Context type `C` for
 * `getContext<C>()` calls within `fn`. Input (V) and Result (R) types are inferred from `fn`.
 * The returned Task is typed as `Task<any, V, R>`, suitable for global use,
 * but `fn` is type-checked against `C`.
 */
export function defineTask<C extends BaseContext, V = any, R = any>( // V, R default to any to allow inference if C is first
  fn: (value: V) => Promise<R>, // V and R will be inferred from this function
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<any, V, R>;
/**
 * Defines a context-aware Task, explicitly specifying Input (V), Result (R),
 * and expected Context (C) types.
 * The returned Task is typed as `Task<any, V, R>`.
 */
export function defineTask<V, R, C extends BaseContext>(
  fn: (value: V) => Promise<R>,
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<any, V, R>;
/**
 * Defines a context-aware Task from a simple asynchronous function.
 *
 * This "smart" version of `defineTask` creates a Task that can be run
 * either within a specific context (established by `createContext` and `run`)
 * or at the top level (implicitly using a default global context).
 *
 * The provided function `fn` should not take `context` as a direct parameter.
 * Instead, it should use `getContext<C>()` internally to access the context
 * active at runtime.
 *
 * The returned Task has its context type parameter as `any` (`Task<any, V, R>`)
 * signifying it can run in various contexts. The `C` generic primarily serves
 * to type-check `getContext<C>()` calls within the body of your `fn`.
 *
 * @param fn The core asynchronous logic of the task.
 * @param taskNameOrOptions Optional name for the task or DefineTaskOptions.
 */
export function defineTask<
  V_Inferred, // Will be inferred from fn if not specified in an overload
  R_Inferred, // Will be inferred from fn if not specified in an overload
  C_Expected extends BaseContext = DefaultGlobalContext,
>(
  fn: (value: V_Inferred) => Promise<R_Inferred>,
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<any, V_Inferred, R_Inferred> {
  // C_Expected is the type hint for `getContext<C>()` calls inside `fn`.
  // The returned Task is `Task<any, ...>` because this smart defineTask
  // creates tasks runnable in any compatible context or the global default.
  return createTaskFunction<
    V_Inferred,
    R_Inferred,
    /* ActualContext for Task signature */ any,
    /* ExpectedContextInFn */ C_Expected
  >(fn, taskNameOrOptions);
}

/**
 * Retrieves the currently active execution context.
 *
 * This "smart" version of `getContext` is the primary way for tasks to access
 * their environment. It operates with the following priority:
 *
 * 1.  **Active Specific Context:** If the current asynchronous flow is operating
 *     within a context established by `createContext<C>().run(...)` or
 *     `createContext<C>().provide(...)`, that specific, typed context is returned.
 *     This is facilitated by `currentUnctxInstance` pointing to the relevant `unctx` store.
 *
 * 2.  **Global Default Context:** If no specific context is active (e.g., when
 *     `getContext` is called at the top level of a module, or within a task
 *     run by the global smart `run` function without a prior specific context),
 *     a shared, global default context object is returned. This global default
 *     is guaranteed to at least satisfy `BaseContext` (containing a `scope`).
 *
 * The generic type parameter `C` allows the caller to assert the expected type of
 * the context.
 *   - If `getContext<UserContext>()` is called within a `run` scope for `UserContext`,
 *     `UserContext` is returned and is fully typed.
 *   - If `getContext<UserContext>()` is called at the top level (global scope),
 *     the global default context object is returned, but **cast** to `UserContext`.
 *     It is the developer's responsibility in such cases to ensure that the
 *     global default context has been appropriately configured (e.g., via
 *     `provideGlobal`) to actually satisfy the `UserContext` interface. Otherwise,
 *     accessing `UserContext`-specific properties might lead to runtime errors
 *     (e.g., `property undefined`).
 *   - If `getContext()` is called with no type argument, it defaults to returning
 *     the `DefaultGlobalContext` type.
 *
 * This function is designed to always return a context object and typically does not throw
 * `ContextNotFoundError` itself (that's more for `getContextLocal`).
 *
 * @template C The expected type of the context. Defaults to `DefaultGlobalContext`.
 * @returns The resolved context, typed as `C`.
 *
 * @example
 * ```typescript
 * import { getContext, createContext, defineTask, type BaseContext, type DefaultGlobalContext } from 'effectively';
 *
 * // 1. Global scope:
 * const globalCtx = getContext(); // Type: DefaultGlobalContext
 * console.log('Global scope signal:', globalCtx.scope.signal.aborted);
 *
 * interface AppEnvContext extends BaseContext { env: string; }
 * // Using provideGlobal to enhance the global context object
 * // await provideGlobal({ env: "production" }, async () => {
 * //   const appEnvCtx = getContext<AppEnvContext>(); // Now safely gets { scope:..., env:"production" }
 * //   console.log(appEnvCtx.env);
 * // });
 *
 * // 2. Specific context scope:
 * interface UserContext extends BaseContext { userId: string; permissions: string[]; }
 * const { run: runUserScope, defineTask: defineUserTask } =
 *   createContext<UserContext>({ userId: 'guest', permissions: [] });
 *
 * const fetchUserData = defineUserTask(async (id: string) => {
 *   const ctx = getContext<UserContext>(); // Type: UserContext. Correctly resolves to the UserContext instance.
 *   console.log(`Fetching data for user ${ctx.userId} (permissions: ${ctx.permissions.join(',')}) with id ${id}`);
 *   if (ctx.userId === 'guest' && id !== 'public') throw new Error("Guest access denied");
 *   return { data: `data_for_${id}` };
 * });
 *
 * // await runUserScope(fetchUserData, 'user123', { overrides: { userId: 'user123', permissions: ['read'] } });
 * ```
 */
export function getContext(): DefaultGlobalContext;
export function getContext<C extends BaseContext>(): C;
export function getContext<C extends BaseContext = DefaultGlobalContext>(): C {
  // 1. Attempt to retrieve the context from the currently active specific unctx instance.
  // This instance (`currentUnctxInstance`) would have been set by a `run` or `provide`
  // call associated with a `createContext<SpecificType>()`.
  const activeSpecificContext = getContextOrUndefinedFromActiveInstance<C>();

  if (activeSpecificContext) {
    // A specific context is active; return it.
    // The type `C` is an assertion by the caller. If they called getContext<WrongType>(),
    // `activeSpecificContext` might not actually be `WrongType`, but `unctx.use()`
    // returns the stored object, and the cast happens here.
    return activeSpecificContext;
  }

  // 2. No specific context is active. Fall back to the global default context object.
  // `getGlobalDefaultContextObjectSingleton()` ensures a minimal global context is always available.
  const globalDefaultInstance = getGlobalDefaultContextObjectSingleton();

  // The caller expects type C. We return the global default instance, and TypeScript
  // will allow the cast if C is structurally compatible with DefaultGlobalContext (or BaseContext).
  // If C is more specific (e.g., AdminContext) and DefaultGlobalContext is minimal (e.g., BaseContext),
  // then `globalDefaultInstance as C` is a potentially unsafe cast if the caller relies on
  // AdminContext-specific properties that don't exist on the minimal global object.
  // This is standard behavior for such "ambient" or "smart" context getters.
  return globalDefaultInstance as C;
}

/**
 * Safely retrieves the currently active execution context as a `Result`.
 *
 * This "smart" version first attempts to resolve a specific context active in the
 * current asynchronous flow. If found, it returns `Ok(context)`.
 * If no specific context is active, it falls back to the global default context
 * and returns `Ok(globalDefaultContext)`.
 *
 * This function itself should generally not throw `ContextNotFoundError` directly,
 * as it aims to always provide a context (even if it's the global default).
 *
 * The type parameter `C` allows the caller to assert the expected shape.
 *
 * @template C The expected type of the context. Defaults to `DefaultGlobalContext`.
 * @returns A `Result<C, ContextNotFoundError>`. `Ok(context)` on success.
 *          It's designed to always return `Ok` because a global default is always available.
 *
 * @example
 * ```typescript
 * const ctxResult = getContextSafe<UserContext>();
 * if (ctxResult.isOk()) {
 *   const userCtx = ctxResult.value; // userCtx is UserContext
 *   // ...
 * }
 * ```
 */
export function getContextSafe(): Result<
  DefaultGlobalContext,
  ContextNotFoundError
>;
export function getContextSafe<C extends BaseContext>(): Result<
  C,
  ContextNotFoundError
>;
export function getContextSafe<
  C extends BaseContext = DefaultGlobalContext,
>(): Result<C, ContextNotFoundError> {
  // 1. Try to get the current specific (active) context
  const activeSpecificContext = getContextOrUndefinedFromActiveInstance<C>();
  if (activeSpecificContext) {
    return ok(activeSpecificContext);
  }

  // 2. No specific context active, fall back to the global default context object.
  // `getGlobalDefaultContextObjectSingleton()` is expected to always return a valid instance.
  const globalDefaultInstance = getGlobalDefaultContextObjectSingleton();

  // Cast the global default instance to the expected type C.
  // See comments in the smart `getContext` about this cast's implications.
  return ok(globalDefaultInstance as C);
}

/**
 * Retrieves the currently active execution context, or the global default if no specific one is active.
 *
 * This "smart" version first attempts to resolve a specific context active in the
 * current asynchronous flow. If found, it's returned.
 * If no specific context is active, it falls back to returning the global default context.
 *
 * This function will always return a context object (either specific or global default)
 * due to the presence of `getGlobalDefaultContextObjectSingleton()`.
 * The `| undefined` in the return type for the generic version is a concession to callers
 * who might expect `getContextOrUndefined` to potentially return `undefined`, though
 * in this setup, it's less likely unless `getContextOrUndefinedFromActiveInstance` or
 * `getGlobalDefaultContextObjectSingleton` were to somehow return `undefined` (which
 * they are not designed to do).
 *
 * @template C The expected type of the context. Defaults to `DefaultGlobalContext`.
 * @returns The resolved context typed as `C` (if specific and active) or the global
 *          default context cast to `C`. It should always return a context object.
 *
 * @example
 * ```typescript
 * const userCtx = getContextOrUndefined<UserContext>();
 * // userCtx will be UserContext if active, or DefaultGlobalContext (cast to UserContext) otherwise.
 * // It will not be undefined if getGlobalDefaultContextObjectSingleton() is robust.
 * if (userCtx) { // This check is more for type narrowing if C could truly be undefined.
 *   console.log(userCtx.scope);
 * }
 * ```
 */
export function getContextOrUndefined(): DefaultGlobalContext; // No undefined for no-args
export function getContextOrUndefined<C extends BaseContext>(): C; // No undefined here either for consistency
export function getContextOrUndefined<
  C extends BaseContext = DefaultGlobalContext,
>(): C {
  // 1. Try to get the current specific (active) context
  const activeSpecificContext = getContextOrUndefinedFromActiveInstance<C>();
  if (activeSpecificContext) {
    return activeSpecificContext;
  }

  // 2. No specific context active, fall back to the global default context object.
  const globalDefaultInstance = getGlobalDefaultContextObjectSingleton();

  // Cast the global default instance to the expected type C.
  return globalDefaultInstance as C;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<any> {
  return (
    value != null && typeof (value as any)[Symbol.asyncIterator] === "function"
  );
}

/**
 * The internal, core execution engine for all workflows.
 * This function is the "dumb" engine: it receives a fully-formed context and
 * simply executes the workflow logic within it. It orchestrates the sequential
 * execution of tasks, manages context propagation via `unctx`, handles
 * backtracking signals, and oversees cancellation.
 *
 * It is not exported publicly. Instead, public-facing `run` functions are
 * responsible for intelligently *constructing* the final `executionContext`
 * before calling this engine.
 *
 * @param unctxInstance The `unctx` instance responsible for managing context propagation.
 * @param workflow The `Task` or composed workflow to execute.
 * @param initialValue The initial value to pass to the first task.
 * @param executionContext The complete, final context object for this run.
 * @param options The `RunOptions` for this execution.
 * @returns A Promise that resolves with the workflow's result or a `Result` object.
 */
async function runImpl<
  V,
  R,
  TaskContext extends BaseContext,
  ExecutionContext extends BaseContext,
>(
  unctxInstance: ReturnType<typeof createUnctx<ExecutionContext>>,
  workflow: Task<TaskContext, V, R>,
  initialValue: V,
  executionContext: ExecutionContext,
  options: RunOptions<ExecutionContext> = {},
): Promise<R | Result<R, WorkflowError>> {
  const logger =
    (executionContext as any)?.logger || options.logger || noopLogger;
  logger.debug(
    `[runImpl] Starting workflow: ${workflow.name || "anonymousTask"}`,
  );

  const allSteps = (workflow as any).__steps || [workflow];
  let currentIndex = 0;
  let currentValue: any = initialValue;
  let backtrackCount = 0;
  const maxBacktracks = 1000;

  const previousActiveUnctxInstance = _INTERNAL_getCurrentUnctxInstance();
  _INTERNAL_setCurrentUnctxInstance(unctxInstance);

  let finalResult: R | undefined; // To store the result before the finally block

  try {
    while (currentIndex < allSteps.length) {
      if (executionContext.scope.signal.aborted) {
        throw new WorkflowError(
          "Workflow aborted",
          executionContext.scope.signal.reason,
          allSteps[currentIndex]?.name,
          currentIndex,
        );
      }
      try {
        const currentTask = allSteps[currentIndex];
        logger.debug(
          `[runImpl] Executing task ${currentIndex}: ${currentTask.name || "anonymousTask"}`,
        );
        currentValue = await unctxInstance.callAsync(executionContext, () =>
          currentTask(executionContext as unknown as TaskContext, currentValue),
        );
        logger.debug(`[runImpl] Task ${currentIndex} completed successfully`);
        currentIndex++;
      } catch (error) {
        if (isBacktrackSignal(error)) {
          backtrackCount++;
          if (backtrackCount > maxBacktracks)
            throw new WorkflowError(
              `Maximum backtrack limit (${maxBacktracks}) exceeded.`,
              error,
            );
          const targetIndex = allSteps.findIndex(
            (step: { __task_id?: symbol }) =>
              step.__task_id === error.target.__task_id,
          );
          if (targetIndex === -1)
            throw new WorkflowError(`BacktrackSignal target not found.`, error);
          if (targetIndex > currentIndex)
            throw new WorkflowError(`Cannot backtrack forward.`, error);
          logger.info(
            `[runImpl] Backtracking from step ${currentIndex} to ${targetIndex}`,
          );
          currentIndex = targetIndex;
          currentValue = error.value;
          continue;
        }
        throw new WorkflowError(
          `Task failed: ${error instanceof Error ? error.message : String(error)}`,
          error,
          allSteps[currentIndex]?.name,
          currentIndex,
        );
      }
    }
    logger.debug("[runImpl] Workflow completed successfully");
    finalResult = currentValue as R; // Store the result

    const shouldThrow = !("throw" in options) || options.throw !== false;
    if (shouldThrow) return finalResult;
    return ok(finalResult);
  } catch (error) {
    const workflowErrorInstance =
      error instanceof WorkflowError
        ? error
        : new WorkflowError("Unhandled error in workflow execution", error);
    logger.error(
      `[runImpl] Workflow failed: ${workflowErrorInstance.message}`,
      workflowErrorInstance,
    );
    const scopeController = (executionContext.scope as any).controller;
    if (scopeController && !scopeController.signal.aborted) {
      scopeController.abort(workflowErrorInstance);
    }
    const shouldThrow = !("throw" in options) || options.throw !== false;
    if (shouldThrow) throw workflowErrorInstance;
    return err(workflowErrorInstance);
  } finally {
    _INTERNAL_setCurrentUnctxInstance(previousActiveUnctxInstance);
    const scopeController = (executionContext.scope as any).controller;

    // ** THIS IS THE CRITICAL FIX **
    // Only abort the controller if the operation is truly finished.
    // If the result is an AsyncIterable, the operation is ongoing, and its
    // lifecycle is now managed by the consumer of the iterable.
    if (
      scopeController &&
      !scopeController.signal.aborted &&
      !isAsyncIterable(finalResult)
    ) {
      scopeController.abort(
        new DOMException("Workflow scope concluded.", "AbortError"),
      );
    }
  }
}

/**
 * Executes a workflow (a Task or a chain of Tasks) with an initial value and options.
 *
 * This "smart" version of `run` intelligently manages context:
 * 1.  **Inheritance:** It determines the parent context (either an active specific
 *     context or the global default).
 * 2.  **Construction:** It creates a new execution context for this run by merging
 *     the parent's properties with any `overrides` provided in the options.
 * 3.  **Scope Management:** It creates a new, unique `scope` for this run, linking
 *     its cancellation to the parent's scope and any `parentSignal` in options.
 *
 * @param workflow The Task or composed workflow to execute.
 * @param initialValue The initial input value for the first task in the workflow.
 * @param options Optional `RunOptions` to control error handling, logging, context
 *                overrides, and parent cancellation signal.
 *
 * @returns A Promise resolving to the workflow's result `R`, or a `Result<R, WorkflowError>`.
 *
 * @example
 * ```typescript
 * // Example 1: Simple top-level execution
 * const myTask = defineTask(async (name: string) => `Hello, ${name}`);
 * const greeting = await run(myTask, 'World'); // -> "Hello, World"
 *
 * // Example 2: With context overrides
 * interface AppContext extends BaseContext { greeting: string; }
 * const myTaskWithContext = defineTask<AppContext, string, string>(async (name) => {
 *   const { greeting } = getContext<AppContext>();
 *   return `${greeting}, ${name}!`;
 * });
 * const result = await run(myTaskWithContext, 'Again', {
 *   overrides: { greeting: 'Hi there' }
 * }); // -> "Hi there, Again!"
 *
 * // Example 3: Handling errors with a Result type
 * const failingTask = defineTask(async () => { throw new Error('Failure'); });
 * const errorResult = await run(failingTask, null, { throw: false });
 * if (errorResult.isErr()) {
 *   console.log(errorResult.error.message); // -> "Task failed: Failure"
 * }
 * ```
 */
export function run<V, R>(
  workflow: Task<any, V, R>,
  initialValue: V,
  options?: RunOptionsThrow<BaseContext>,
): Promise<R>;
export function run<V, R>(
  workflow: Task<any, V, R>,
  initialValue: V,
  options: RunOptionsResult<BaseContext>,
): Promise<Result<R, WorkflowError>>;
export function run<C extends BaseContext, V, R>(
  workflow: Task<C, V, R>,
  initialValue: V,
  options?: RunOptionsThrow<C>,
): Promise<R>;
export function run<C extends BaseContext, V, R>(
  workflow: Task<C, V, R>,
  initialValue: V,
  options: RunOptionsResult<C>,
): Promise<Result<R, WorkflowError>>;

export function run<
  V,
  R,
  WorkflowCtx extends BaseContext,
  O extends BaseContext,
>(
  workflow: Task<WorkflowCtx, V, R>,
  initialValue: V,
  options: RunOptions<O> = {},
): Promise<R | Result<R, WorkflowError>> {
  const { overrides, parentSignal } = options;

  // 1. Determine the parent context and the `unctx` instance to use for this run.
  const activeSpecificContext =
    getContextOrUndefinedFromActiveInstance<BaseContext>();
  const parentContext =
    activeSpecificContext || getGlobalDefaultContextObjectSingleton();
  const unctxForThisRun =
    (activeSpecificContext &&
      (activeSpecificContext as any)[UNCTX_INSTANCE_SYMBOL]) ||
    getGlobalUnctx();

  // 2. Create a new, cancellable scope for this specific run.
  const controller = new AbortController();
  const onParentAbort = () =>
    controller.abort(parentSignal?.reason || parentContext.scope.signal.reason);

  const signalsToWatch = [parentContext.scope.signal, parentSignal].filter(
    Boolean,
  ) as AbortSignal[];
  signalsToWatch.forEach((sig) =>
    sig.aborted
      ? onParentAbort()
      : sig.addEventListener("abort", onParentAbort, { once: true }),
  );

  // Expose the controller on the scope for internal cleanup.
  const newScope = { signal: controller.signal, controller };

  // 3. Construct the final, type-safe context object for THIS execution.
  //    It inherits from the parent, is layered with overrides, and gets a new scope.
  const executionContext = {
    ...parentContext,
    ...overrides,
    scope: newScope,
  };

  // Tag the context object with its managing unctx instance for discovery by nested calls.
  Object.defineProperty(executionContext, UNCTX_INSTANCE_SYMBOL, {
    value: unctxForThisRun,
    enumerable: false,
    writable: false,
    configurable: true,
  });

  // Explicitly copy any symbol-keyed properties from overrides.
  if (overrides) {
    Object.getOwnPropertySymbols(overrides).forEach((symKey) => {
      (executionContext as any)[symKey] = (overrides as any)[symKey];
    });
  }

  // 4. Call the internal run implementation with the fully constructed context.
  return runImpl(
    unctxForThisRun,
    workflow as Task<any, V, R>,
    initialValue,
    executionContext,
    options,
  ).finally(() => {
    // Clean up event listeners after the run is completely finished.
    signalsToWatch.forEach((sig) =>
      sig.removeEventListener("abort", onParentAbort),
    );
  });
}

/**
 * Internal Helper: Retrieves the currently relevant context object.
 *
 * It prioritizes returning an active specific context if one exists (managed by
 * `currentUnctxInstance`). If no specific context is active, it falls back to
 * returning the singleton global default context object.
 *
 * This function is designed to always return a context object, ensuring that
 * functions relying on it (like `inject` or `injectOptional`) always have
 * a context to inspect, even if it's the minimal global default.
 *
 * The return type is `any` here because this helper is used by various internal
 * functions (like `inject`) that might be dealing with different potential context
 * types before a final cast or type assertion by the public-facing API (like `getContext<C>`).
 *
 * @returns The most relevant active context object, or the global default context object.
 *          Typed as `any` for internal flexibility, but concretely it will be
 *          either `C extends BaseContext` (if specific is active) or `DefaultGlobalContext`.
 */
function getCurrentOrDefaultContext(): any {
  // Returning `any` is okay for this internal helper
  // as consumer functions (like inject) will cast or use it cautiously.
  // Alternatively, return `BaseContext` or `DefaultGlobalContext | SpecificActiveContext`.
  // `BaseContext` is probably the safest common type.
  // Let's refine the return type to be more specific than `any` for better internal reasoning:
  // function getCurrentOrDefaultContext(): BaseContext { // Or even `DefaultGlobalContext | C` where C is from active

  // 1. Try to get an active specific context.
  // `getContextOrUndefinedFromActiveInstance` correctly uses `currentUnctxInstance`.
  // We don't need to specify a generic for C here if we are fine with it returning
  // whatever type is stored, which will be BaseContext or a subtype.
  const activeSpecificContext =
    getContextOrUndefinedFromActiveInstance<BaseContext>(); // Use BaseContext as a safe minimum

  if (activeSpecificContext) {
    return activeSpecificContext;
  }

  // 2. No specific context is active. Fall back to the singleton global default context object.
  // `getGlobalDefaultContextObjectSingleton()` ensures a minimal global context object is always available.
  return getGlobalDefaultContextObjectSingleton();
}

/**
 * Internal implementation for providing a new context scope.
 *
 * @param unctxInstanceForThisScope The unctx instance to manage this scope.
 * @param parentContextData The base context data to build upon.
 * @param overrides Properties to temporarily add/override.
 * @param fn The function to execute in the new scope.
 * @param options Options, including the strategy ('spread' or 'proxy').
 * @returns The result of the function `fn`.
 */
async function _INTERNAL_provideImpl<
  R,
  ParentCtx extends BaseContext,
  OverridesCtx extends BaseContext,
>(
  unctxInstanceForThisScope: ReturnType<typeof createUnctx<any>>,
  parentContextData: ParentCtx,
  overrides: Partial<
    Omit<OverridesCtx, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
      Record<string | symbol, any>
  >,
  fn: () => Promise<R>,
  options: ProvideImplOptions = {},
): Promise<R> {
  const strategy = options.strategy || "spread"; // Default to spread

  const previousActiveUnctxInstance = _INTERNAL_getCurrentUnctxInstance();
  _INTERNAL_setCurrentUnctxInstance(unctxInstanceForThisScope);

  let newExecutionContext: ParentCtx & Partial<OverridesCtx>; // Approximate combined type

  try {
    if (strategy === "proxy") {
      // --- Proxy Strategy ---
      const currentOverrides = { ...overrides }; // Shallow copy for this scope's overrides

      const proxyHandler: ProxyHandler<BaseContext> = {
        get(target, prop, receiver) {
          if (prop === UNCTX_INSTANCE_SYMBOL) return unctxInstanceForThisScope;
          if (prop === "scope") return parentContextData.scope;
          if (Reflect.has(currentOverrides, prop))
            return Reflect.get(currentOverrides, prop, receiver);
          return Reflect.get(parentContextData, prop, receiver);
        },
        has(target, prop) {
          if (prop === UNCTX_INSTANCE_SYMBOL || prop === "scope") return true;
          return (
            Reflect.has(currentOverrides, prop) ||
            Reflect.has(parentContextData, prop)
          );
        },
        set(target, prop, value, receiver) {
          if (prop === "scope" || prop === UNCTX_INSTANCE_SYMBOL) {
            console.warn(
              `[Effectively.provideImpl] Attempted to set read-only property: ${String(prop)}`,
            );
            return false;
          }
          Reflect.set(currentOverrides, prop, value, receiver);
          return true;
        },
        deleteProperty(target, prop) {
          if (prop === "scope" || prop === UNCTX_INSTANCE_SYMBOL) {
            console.warn(
              `[Effectively.provideImpl] Attempted to delete read-only property: ${String(prop)}`,
            );
            return false;
          }
          if (Reflect.has(currentOverrides, prop))
            return Reflect.deleteProperty(currentOverrides, prop);
          return true; // Or Reflect.deleteProperty(parentContextData, prop) if desired
        },
        ownKeys(target) {
          const overrideKeys = Reflect.ownKeys(currentOverrides);
          const parentKeys = Reflect.ownKeys(parentContextData);
          return Array.from(
            new Set([
              ...overrideKeys,
              ...parentKeys,
              UNCTX_INSTANCE_SYMBOL,
              "scope",
            ]),
          );
        },
        getOwnPropertyDescriptor(target, prop) {
          if (prop === UNCTX_INSTANCE_SYMBOL)
            return {
              value: unctxInstanceForThisScope,
              writable: false,
              enumerable: false,
              configurable: true,
            };
          if (prop === "scope") {
            const parentDesc = Reflect.getOwnPropertyDescriptor(
              parentContextData,
              "scope",
            );
            return parentDesc
              ? { ...parentDesc, writable: false, configurable: false }
              : undefined;
          }
          if (Reflect.has(currentOverrides, prop))
            return Reflect.getOwnPropertyDescriptor(currentOverrides, prop);
          return Reflect.getOwnPropertyDescriptor(parentContextData, prop);
        },
      };
      newExecutionContext = new Proxy(
        parentContextData,
        proxyHandler,
      ) as ParentCtx & Partial<OverridesCtx>;
    } else {
      // --- Spread Strategy (Default) ---
      newExecutionContext = {
        ...parentContextData,
        ...overrides, // Overrides win
        scope: parentContextData.scope, // Explicitly inherit scope
      } as ParentCtx & Partial<OverridesCtx>;

      // Tag with the unctx instance managing this scope.
      Object.defineProperty(newExecutionContext, UNCTX_INSTANCE_SYMBOL, {
        value: unctxInstanceForThisScope,
        enumerable: false,
        writable: false,
        configurable: false,
      });

      // Explicitly copy symbol-keyed properties from overrides for spread strategy
      Object.getOwnPropertySymbols(overrides).forEach((symKey) => {
        if (
          symKey.toString() !== "Symbol(scope)" &&
          symKey !== UNCTX_INSTANCE_SYMBOL
        ) {
          (newExecutionContext as any)[symKey] = (overrides as any)[symKey];
        }
      });
    }

    return unctxInstanceForThisScope.callAsync(newExecutionContext, fn);
  } finally {
    _INTERNAL_setCurrentUnctxInstance(previousActiveUnctxInstance);
  }
}

/**
 * Executes a given function within a new context scope that temporarily
 * includes the specified overrides.
 *
 * This "smart" version of `provide` intelligently manages context nesting:
 * 1.  **Nested Provide:** If called from within an already active Effectively context
 *     (e.g., a task calling `provide` for a sub-operation), it creates a new
 *     nested context that inherits from the parent. The `unctx` instance of the
 *     parent context is used to manage this new nested scope.
 * 2.  **Top-Level Provide:** If called outside any active Effectively context,
 *     it uses the global default context as the base and the global `unctx`
 *     instance to manage the new scope.
 *
 * The `scope` (and its `AbortSignal`) from the parent/base context is always
 * inherited by the new context created by `provide` to ensure cancellation
 * propagates correctly. Overrides cannot change the `scope`.
 *
 * @template R The result type of the function `fn`.
 * @template CtxForOverrides Used by overloads to type `overrides` more specifically
 *                           if `provide` is called in a way that implies a known context type.
 *                           Defaults to `BaseContext`.
 *
 * @param overrides An object containing properties to merge into (or override on)
 *                  the parent/base context for the duration of `fn`'s execution.
 *                  The `scope` property cannot be overridden.
 * @param fn The asynchronous function to execute within the new, modified context.
 *           Calls to `getContext()` within this function will resolve to the new context.
 * @param options ParamImplOptions
 * @returns A Promise that resolves with the result of `fn`.
 *
 * @example
 * ```typescript
 * // At top level (uses global context as base)
 * await provide({ myService: mockService }, async () => {
 *   const ctx = getContext(); // ctx will have myService and global defaults
 *   // await run(someTaskThatUsesMyService);
 * });
 *
 * // Nested within a specific context
 * const { run, defineTask, provide: specificProvide } = createContext<UserContext>(...);
 * const myTask = defineTask(async () => {
 *   await specificProvide({ temporaryFlag: true }, async () => {
 *     const innerCtx = getContext<UserContext & { temporaryFlag: boolean }>();
 *     // innerCtx has UserContext properties + temporaryFlag
 *   });
 * });
 * ```
 */
export function provide<R>(
  overrides: Partial<
    Omit<DefaultGlobalContext, "scope"> & Record<string | symbol | number, any>
  >,
  fn: () => Promise<R>,
  options?: ProvideImplOptions,
): Promise<R>;
export function provide<C extends BaseContext, R>(
  overrides: Partial<Omit<C, "scope"> & Record<string | symbol | number, any>>, // `overrides` typed against `C`
  fn: () => Promise<R>,
  options?: ProvideImplOptions,
): Promise<R>;
export function provide<R, CtxForOverrides extends BaseContext = BaseContext>(
  overrides: Partial<
    Omit<CtxForOverrides, "scope"> & Record<string | symbol | number, any>
  >,
  fn: () => Promise<R>,
  options?: ProvideImplOptions,
): Promise<R> {
  const activeSpecificContext =
    getContextOrUndefinedFromActiveInstance<CtxForOverrides>();

  let unctxInstanceForThisScope: ReturnType<typeof createUnctx<any>>;
  let parentContextData: BaseContext;

  if (
    activeSpecificContext &&
    (activeSpecificContext as any)[UNCTX_INSTANCE_SYMBOL]
  ) {
    unctxInstanceForThisScope = (activeSpecificContext as any)[
      UNCTX_INSTANCE_SYMBOL
    ];
    parentContextData = activeSpecificContext;
  } else {
    unctxInstanceForThisScope = getGlobalUnctx();
    parentContextData = getGlobalDefaultContextObjectSingleton();
  }

  return _INTERNAL_provideImpl(
    unctxInstanceForThisScope,
    parentContextData,
    overrides,
    fn,
    options || { strategy: "spread" },
  );
}

/**
 * Creates a new context scope with temporary overrides using a Proxy.
 * This version avoids cloning the parent context object for performance benefits
 * in scenarios with frequent `provide` calls or very large context objects.
 *
 * The returned Proxy layers the `overrides` on top of the `parentContextData`.
 * Property access prioritizes `overrides`. The `scope` property is always
 * inherited from the `parentContextData` and cannot be overridden.
 * The `UNCTX_INSTANCE_SYMBOL` is also specially handled to point to the
 * `unctx` instance managing this new proxied scope.
 *
 * @template R The result type of the function `fn`.
 * @template CtxForOverrides The asserted type of the context including overrides.
 *                           The actual parent context might be `BaseContext` or `DefaultGlobalContext`.
 *
 * @param overrides An object containing properties to make available in the new scope.
 *                  The `scope` property in `overrides` will be ignored.
 * @param fn The asynchronous function to execute within the new proxied context scope.
 *
 * @returns A Promise that resolves with the result of `fn`.
 */
export function provideWithProxy<
  R,
  CtxForOverrides extends BaseContext = BaseContext,
>(
  overrides: Partial<
    Omit<CtxForOverrides, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
      Record<string | symbol, any>
  >,
  fn: () => Promise<R>,
): Promise<R> {
  const activeSpecificContext =
    getContextOrUndefinedFromActiveInstance<CtxForOverrides>();

  let unctxInstanceForThisScope: ReturnType<typeof createUnctx<any>>;
  let parentContextData: BaseContext;

  if (activeSpecificContext && UNCTX_INSTANCE_SYMBOL in activeSpecificContext) {
    unctxInstanceForThisScope = (activeSpecificContext as any)[
      UNCTX_INSTANCE_SYMBOL
    ];
    parentContextData = activeSpecificContext;
  } else {
    unctxInstanceForThisScope = getGlobalUnctx();
    parentContextData = getGlobalDefaultContextObjectSingleton();
  }

  return _INTERNAL_provideImpl(
    unctxInstanceForThisScope,
    parentContextData,
    overrides,
    fn,
    { strategy: "proxy" }, // Explicitly use proxy
  );
}

// =================================================================
// Section 2.3: Local-Only Context Functions (current context required)
// =================================================================

/**
 * Defines a Task that is **strictly bound to the currently active specific context**.
 *
 * If no specific Effectively context is active when this function is called
 * (i.e., not within a `run` or `provide` scope initiated by `createContext().tools`),
 * this function will throw a `ContextNotFoundError`.
 *
 * The created Task, when executed by `runLocal` or a context-specific `run`, will
 * operate within that active context `C`. Internal `getContext<C>()` calls within
 * the task's `fn` logic will resolve to this `C`.
 *
 * @template C The specific `BaseContext` type of the *currently active* context.
 *             This is an assertion by the caller; the function checks for any active context.
 * @template V The input value type for the task's logic.
 * @template R The result type the task's logic will resolve to.
 *
 * @param fn The core asynchronous logic of the task.
 * @param taskNameOrOptions Optional name or options for the task.
 * @returns A `Task<C, V, R>`, typed to the asserted active context `C`.
 * @throws {ContextNotFoundError} If no specific context is active when `defineTaskLocal` is called.
 */
export function defineTaskLocal<C extends BaseContext, V, R>(
  fn: (value: V) => Promise<R>,
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<C, V, R> {
  // Check for an active context first. This check is at defineTaskLocal call time.
  const activeContext = getContextOrUndefinedFromActiveInstance<C>();
  if (!activeContext) {
    throw new ContextNotFoundError(
      "defineTaskLocal requires an active specific context. It cannot be called at the top level " +
        "without an established context from run() or provide().",
    );
  }
  // If an active context exists, we create a task. The `C` generic here is an assertion
  // by the caller about the type of this `activeContext`.
  // The task created will be typed as Task<C, V, R>.
  // `createTaskFunction` will type its ActualContext and ExpectedContextInFn as C.
  return createTaskFunction<V, R, C, C>(fn, taskNameOrOptions);
}

/**
 * Retrieves the **currently active specific context**, throwing an error if none is found.
 * This function *never* falls back to a global default context.
 *
 * @template C The expected type of the active specific context.
 * @returns The active specific context, typed as `C`.
 * @throws {ContextNotFoundError} If no specific context is active.
 */
export function getContextLocal<C extends BaseContext>(): C {
  const activeContext = getContextOrUndefinedFromActiveInstance<C>();
  if (!activeContext) {
    throw new ContextNotFoundError(
      "getContextLocal requires an active specific context. No global fallback is used.",
    );
  }
  return activeContext;
}

/**
 * Safely retrieves the **currently active specific context** as a `Result`,
 * returning `Err(ContextNotFoundError)` if none is found.
 * This function *never* falls back to a global default context.
 *
 * @template C The expected type of the active specific context.
 * @returns `Ok(context)` if an active specific context is found, otherwise `Err(ContextNotFoundError)`.
 */
export function getContextSafeLocal<C extends BaseContext>(): Result<
  C,
  ContextNotFoundError
> {
  const activeContext = getContextOrUndefinedFromActiveInstance<C>();
  if (!activeContext) {
    return err(
      new ContextNotFoundError(
        "getContextSafeLocal requires an active specific context. No global fallback is used.",
      ),
    );
  }
  return ok(activeContext);
}

/**
 * Retrieves the **currently active specific context**, or `undefined` if none is found.
 * This function *never* falls back to a global default context.
 *
 * @template C The expected type of the active specific context.
 * @returns The active specific context typed as `C`, or `undefined`.
 */
export function getContextOrUndefinedLocal<C extends BaseContext>():
  | C
  | undefined {
  return getContextOrUndefinedFromActiveInstance<C>();
}

/**
 * Executes a workflow **exclusively within the currently active specific context**.
 *
 * If no specific Effectively context is active when `runLocal` is called, it will
 * either throw a `ContextNotFoundError` (if `options.throw` is `true` or default)
 * or return an `Err(WorkflowError)` (if `options.throw` is `false`).
 * It *never* falls back to a global default context.
 *
 * The `workflow` (often created with `defineTaskLocal` or a context-specific `defineTask`)
 * must be compatible with the active context `C`.
 *
 * @template C The specific `BaseContext` type of the *currently active* context.
 * @template V The input value type for the workflow.
 * @template R The result type of the workflow.
 *
 * @param workflow The Task or workflow to execute, typed as `Task<C, V, R>`.
 * @param initialValue The initial input value for the workflow.
 * @param options Optional `RunOptions<C>` for this local run. Overrides apply to the
 *                currently active context.
 *
 * @returns A Promise resolving to `R` or `Result<R, WorkflowError>` based on `options.throw`.
 * @throws {ContextNotFoundError} If `options.throw` is not `false` and no active specific context.
 */
export function runLocal<C extends BaseContext, V, R>(
  workflow: Task<C, V, R>,
  initialValue: V,
  options?: RunOptionsThrow<C>,
): Promise<R>;
export function runLocal<C extends BaseContext, V, R>(
  workflow: Task<C, V, R>,
  initialValue: V,
  options: RunOptionsResult<C>,
): Promise<Result<R, WorkflowError>>;
export function runLocal<C extends BaseContext, V, R>(
  workflow: Task<C, V, R>,
  initialValue: V,
  options: RunOptions<C> = {},
): Promise<R | Result<R, WorkflowError>> {
  const activeContext = getContextOrUndefinedFromActiveInstance<C>();

  if (!activeContext) {
    const error = new ContextNotFoundError(
      "runLocal requires an active specific context. No global fallback is used.",
    );
    const shouldThrow = !("throw" in options) || options.throw !== false;
    if (shouldThrow) {
      throw error;
    }
    return Promise.resolve(
      err(new WorkflowError("Context not found for runLocal", error)),
    );
  }

  // Retrieve the unctx instance that manages the activeContext.
  // This is crucial for correct nesting and async propagation.
  const unctxInstanceForThisRun = (activeContext as any)[
    UNCTX_INSTANCE_SYMBOL
  ] as ReturnType<typeof createUnctx<C>> | undefined;

  if (!unctxInstanceForThisRun) {
    // This is an unexpected state: an active context was found but it's not tagged
    // with its managing unctx instance. This indicates an internal library issue or
    // that activeContext came from a source not managed by Effectively's createContext.
    const internalError = new Error(
      "[Effectively Internal Error] runLocal found an active context that is not tagged " +
        "with its UNCTX_INSTANCE_SYMBOL. Cannot proceed with proper context management.",
    );
    console.error(internalError, { activeContext });
    const shouldThrow = !("throw" in options) || options.throw !== false;
    if (shouldThrow) {
      throw internalError;
    }
    return Promise.resolve(
      err(new WorkflowError(internalError.message, internalError)),
    );
  }

  // `activeContext` (which is `Omit<C, 'scope'> & { scope: Scope }`) serves as the
  // `baseContextDataForExecution` for `_INTERNAL_runImpl`.
  // `options.overrides` will be applied on top of `activeContext`.
  // The `TaskContext` for `_INTERNAL_runImpl` is `C` (from `workflow: Task<C,V,R>`).
  // The `ExecutionContextType` for `_INTERNAL_runImpl` is also `C`.
  return runImpl<V, R, C, C>(
    unctxInstanceForThisRun,
    workflow,
    initialValue,
    activeContext, // The active context itself is the base (already includes its own defaults + previous overrides)
    options,
  );
}

/**
 * Executes a function within a new nested scope derived from the **currently active
 * specific context**, including the specified overrides.
 *
 * If no specific Effectively context is active when `provideLocal` is called,
 * it will throw a `ContextNotFoundError`. It *never* falls back to a global default.
 * The `scope` from the active specific context is inherited.
 *
 * @template C The specific `BaseContext` type of the *currently active* context.
 * @template R The result type of the function `fn`.
 *
 * @param overrides An object of properties to merge into (or override on) the
 *                  active specific context `C` for `fn`'s execution.
 * @param fn The asynchronous function to execute. `getContextLocal<C>()` or `getContext<C>()`
 *           within `fn` will resolve to the new nested context.
 * @param options Optional `ProvideImplOptions` (e.g., to specify 'proxy' strategy).
 *
 * @returns A Promise that resolves with the result of `fn`.
 * @throws {ContextNotFoundError} If no active specific context is found.
 */
export function provideLocal<C extends BaseContext, R>(
  overrides: Partial<
    Omit<C, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
      Record<string | symbol, any>
  >,
  fn: () => Promise<R>,
  options?: ProvideImplOptions,
): Promise<R> {
  const activeContext = getContextOrUndefinedFromActiveInstance<C>();

  if (!activeContext) {
    throw new ContextNotFoundError(
      "provideLocal requires an active specific context. No global fallback is used.",
    );
  }

  const unctxInstanceForThisScope = (activeContext as any)[
    UNCTX_INSTANCE_SYMBOL
  ] as ReturnType<typeof createUnctx<C>> | undefined;

  if (!unctxInstanceForThisScope) {
    throw new Error( // This should be a more severe internal error
      "[Effectively Internal Error] provideLocal found an active context that is not tagged " +
        "with its UNCTX_INSTANCE_SYMBOL. Cannot create nested scope correctly.",
    );
  }

  // `activeContext` serves as the `parentContextData` for `_INTERNAL_provideImpl`.
  // `OverridesCtx` for `_INTERNAL_provideImpl` is `C` (type of the active context).
  return _INTERNAL_provideImpl<R, C, C>(
    unctxInstanceForThisScope,
    activeContext, // The current active context is the parent
    overrides,
    fn,
    options,
  );
}

// =================================================================
// Section 2.4: Global-Only Context Functions (for explicit use)
// =================================================================

/**
 * Defines a Task that is **always** bound to the global default context.
 *
 * When this task is executed (e.g., via `runGlobal` or even a specific `run`),
 * any internal calls to `getContext()` will resolve to the global default context object,
 * regardless of any other specific context that might have been active when `run` was called.
 *
 * This is useful for creating utility tasks or services that should consistently
 * operate with global settings or state, bypassing any local context overrides.
 *
 * The `fn` (task logic) should use `getContext<DefaultGlobalContext>()` or simply `getContext()`
 * to access the global context.
 *
 * @template V The input value type for the task's logic.
 * @template R The result type the task's logic will resolve to.
 *
 * @param fn The core asynchronous logic of the task.
 * @param taskNameOrOptions Optional name or options for the task.
 * @returns A `Task<DefaultGlobalContext, V, R>`, specifically typed to the global context.
 */
export const defineTaskGlobal = <V, R>(
  fn: (value: V) => Promise<R>,
  taskNameOrOptions?: string | DefineTaskOptions,
): Task<DefaultGlobalContext, V, R> => {
  // `createTaskFunction` is called with DefaultGlobalContext for both ActualContext and ExpectedContextInFn.
  // This ensures the task signature is Task<DefaultGlobalContext, V, R> and internal
  // getContext() calls are type-checked against DefaultGlobalContext.
  return createTaskFunction<V, R, DefaultGlobalContext, DefaultGlobalContext>(
    fn,
    taskNameOrOptions,
  );
};

/**
 * Retrieves the singleton global default context object.
 * This function *always* returns the global default context, ignoring any
 * active specific context.
 *
 * @returns The `DefaultGlobalContext` object.
 */
export const getContextGlobal = (): DefaultGlobalContext => {
  return getGlobalDefaultContextObjectSingleton();
};

/**
 * Executes a workflow **exclusively** within the global default context.
 * Any active specific context that might exist when `runGlobal` is called
 * will be ignored for the execution of this workflow and its tasks.
 * Internal `getContext()` calls within the workflow will resolve to the
 * global default context object.
 *
 * @template V The input value type for the workflow.
 * @template R The result type of the workflow.
 *
 * @param workflow The Task (often created with `defineTaskGlobal`) or workflow to execute.
 *                 It should be typed as `Task<DefaultGlobalContext, V, R>` or `Task<any, V, R>`.
 * @param initialValue The initial input value for the workflow.
 * @param options Optional `RunOptions<DefaultGlobalContext>` for this global run.
 *                Overrides here apply on top of the `globalDefaultContextObject`.
 *
 * @returns A Promise resolving to `R` or `Result<R, WorkflowError>` based on `options.throw`.
 */
export function runGlobal<V, R>(
  workflow: Task<DefaultGlobalContext, V, R> | Task<any, V, R>, // Accepts globally or specifically (any) defined tasks
  initialValue: V,
  options?: RunOptionsThrow<DefaultGlobalContext>,
): Promise<R>;
export function runGlobal<V, R>(
  workflow: Task<DefaultGlobalContext, V, R> | Task<any, V, R>,
  initialValue: V,
  options: RunOptionsResult<DefaultGlobalContext>,
): Promise<Result<R, WorkflowError>>;
export function runGlobal<V, R>(
  workflow: Task<DefaultGlobalContext, V, R> | Task<any, V, R>,
  initialValue: V,
  options: RunOptions<DefaultGlobalContext> = {},
): Promise<R | Result<R, WorkflowError>> {
  const globalUnctx = getGlobalUnctx();
  const globalDefaults = getGlobalDefaultContextObjectSingleton();

  // TaskContext for runImpl is DefaultGlobalContext (what the workflow expects if it's a global task)
  // ExecutionContextType for runImpl is also DefaultGlobalContext (the context we are establishing)
  // The workflow itself is cast to Task<any,V,R> to satisfy _INTERNAL_runImpl's TaskContext generic,
  // as _INTERNAL_runImpl passes its ExecutionContext to the task, ensuring compatibility.
  return runImpl<V, R, any, DefaultGlobalContext>(
    globalUnctx,
    workflow as Task<any, V, R>,
    initialValue,
    globalDefaults, // Base data for this run is the global defaults
    options,
  );
}

/**
 * Executes a function within a new scope that is an extension of the
 * **global default context**, including the specified overrides.
 * Any active specific context is ignored.
 *
 * The `scope` from the global default context object is inherited.
 *
 * @template R The result type of the function `fn`.
 *
 * @param overrides An object containing properties to merge into (or override on)
 *                  the global default context for `fn`'s execution.
 * @param fn The asynchronous function to execute. `getContext()` within `fn` will
 *           resolve to the new context based on global defaults + overrides.
 * @param options Optional `ProvideImplOptions` (e.g., to specify 'proxy' strategy).
 *
 * @returns A Promise that resolves with the result of `fn`.
 */
export const provideGlobal = <R>(
  overrides: Partial<
    Omit<DefaultGlobalContext, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
      Record<string | symbol, any>
  >,
  fn: () => Promise<R>,
  options?: ProvideImplOptions, // Allow strategy selection
): Promise<R> => {
  const globalUnctx = getGlobalUnctx();
  const globalDefaults = getGlobalDefaultContextObjectSingleton();

  // ParentCtx and OverridesCtx for _INTERNAL_provideImpl are both DefaultGlobalContext
  return _INTERNAL_provideImpl<R, DefaultGlobalContext, DefaultGlobalContext>(
    globalUnctx,
    globalDefaults, // Parent data is the global default object
    overrides,
    fn,
    options, // Pass along strategy options
  );
};

// =================================================================
// Section 2: Context Utility Functions
// =================================================================

/**
 * Validates a context object against a schema.
 * Returns a Result indicating success or failure with detailed error information.
 */
export function validateContext<C extends BaseContext>(
  schema: ContextSchema<C>,
  context: unknown,
): Result<C, ContextValidationError> {
  if (!context || typeof context !== "object") {
    return {
      isOk: () => false,
      isErr: () => true,
      error: new ContextValidationError("root", "object", context),
    } as Err<C, ContextValidationError>;
  }

  const ctx = context as Record<string, unknown>;

  // Validate each field in the schema
  for (const [field, validator] of Object.entries(schema) as Array<
    [string, ContextValidator<unknown>]
  >) {
    const value = ctx[field];
    if (!validator(value)) {
      return {
        isOk: () => false,
        isErr: () => true,
        error: new ContextValidationError(field, "valid type", value),
      } as Err<C, ContextValidationError>;
    }
  }

  return {
    isOk: () => true,
    isErr: () => false,
    value: context as C,
  } as Ok<C, ContextValidationError>;
}

/**
 * Type-safe context merging function.
 * Combines two contexts, with properties in the second context taking precedence.
 */
export function mergeContexts<
  A extends BaseContext,
  B extends Record<string, unknown>,
>(contextA: A, contextB: B): MergeContexts<A, B> {
  return {
    ...contextA,
    ...contextB,
    scope: contextA.scope, // Always preserve the original scope
  } as MergeContexts<A, B>;
}

/**
 * Creates a context transformer function that can be used to modify contexts.
 */
export function createContextTransformer<
  C1 extends BaseContext,
  C2 extends BaseContext,
>(transformer: (ctx: C1) => Omit<C2, "scope">): (ctx: C1) => C2 {
  return (ctx: C1): C2 => {
    const transformed = transformer(ctx);
    return {
      ...transformed,
      scope: ctx.scope, // Always preserve the scope
    } as C2;
  };
}

/**
 * Type-safe context property accessor.
 * Provides compile-time safety when accessing context properties.
 */
export function useContextProperty<K extends keyof DefaultGlobalContext>(
  key: K,
): DefaultGlobalContext[K];
export function useContextProperty<C extends BaseContext, K extends keyof C>(
  key: K,
): C[K];
export function useContextProperty<K extends string | number | symbol>(
  key: K,
): any {
  const context = getContext();
  return context[key as keyof typeof context];
}

/**
 * Requires specific properties to be present in the context.
 * Throws a descriptive error if any required property is missing.
 */
export function requireContextProperties<
  C extends BaseContext = DefaultGlobalContext,
>(...requirements: (keyof C)[]): C {
  const context = getContext<C>();
  const missing: string[] = [];

  for (const requirement of requirements) {
    if (
      !(requirement in context) ||
      context[requirement as keyof C] === undefined
    ) {
      missing.push(String(requirement));
    }
  }

  if (missing.length > 0) {
    throw new ContextValidationError(
      missing.join(", "),
      "defined properties",
      "undefined",
    );
  }

  return context;
}

/**
 * Creates a task that provides additional context to its child task.
 */
export function withContextEnhancement<
  C extends BaseContext,
  Enhancement extends Record<string, unknown>,
  V,
  R,
>(
  enhancement: Enhancement,
  task: Task<MergeContexts<C, Enhancement>, V, R>,
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
export function createInjectionToken<T>(
  description: string,
): InjectionToken<T> {
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
  const context = getCurrentOrDefaultContext() as BaseContext &
    Record<symbol, unknown>;
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
  const context = getCurrentOrDefaultContext() as BaseContext &
    Record<symbol, unknown>;
  return context[token as symbol] as T | undefined;
}

/**
 * Creates a context provider that supplies a value for a specific token.
 */
export function createContextProvider<T>(token: InjectionToken<T>): {
  Provider: <C extends BaseContext, V, R>(
    value: T,
    task: Task<C & Record<symbol, T>, V, R>,
  ) => Task<C, V, R>;
  useValue: () => T;
} {
  const Provider = <C extends BaseContext, V, R>(
    value: T,
    task: Task<C & Record<symbol, T>, V, R>,
  ): Task<C, V, R> => {
    return async (context: C, input: V): Promise<R> => {
      const enhancedContext = {
        ...context,
        [token]: value,
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
  task: Task<C, V, R>,
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    let enhancedContext = { ...context };

    for (const provider of providers) {
      enhancedContext = {
        ...enhancedContext,
        [provider.provide]: provider.value,
      };
    }

    return task(enhancedContext as C, value);
  };
}

/**
 * Higher-order function that creates a task with pre-configured dependencies.
 */
export function withDependencies<
  C extends BaseContext,
  Deps extends Record<string, unknown>,
>(dependencies: Deps) {
  return function configureDependencies<V, R>(
    taskFactory: (deps: Deps) => Task<C, V, R>,
  ): Task<C, V, R> {
    const task = taskFactory(dependencies);
    return task;
  };
}

/**
 * Creates a lazy-loaded dependency that is only instantiated when first accessed.
 */
export function createLazyDependency<T>(
  factory: () => T | Promise<T>,
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

    loading = Promise.resolve(factory()).then((result) => {
      instance = result;
      loading = undefined;
      return result;
    });

    return loading;
  };
}

export type ProvideStrategy = "spread" | "proxy";

export interface ProvideImplOptions {
  strategy?: ProvideStrategy;
}

// =================================================================
// Section 4: The `createContext` Factory and `run` Engine
// =================================================================

/**
 * Creates a new, isolated "Effectively" execution environment, providing a
 * set of tools (`ContextTools`) strongly typed to a specific context shape `C`.
 *
 * Each call to `createContext` establishes a distinct context system with its
 * own internal state for asynchronous context propagation (via `unctx` and
 * typically `AsyncLocalStorage`). This ensures that tasks run using tools from
 * one `createContext` call do not interfere with tasks run by tools from another.
 *
 * The `defaultContextDataForC` parameter provides the initial, default values
 * (excluding `scope`) for this specific context type `C`. The `scope` (containing
 * an `AbortSignal`) is managed automatically by the `run` method of the returned tools.
 *
 * @template C The specific type of the context that this environment will manage.
 *             It must extend `BaseContext` (which requires a `scope` property).
 *             Example: `interface UserSessionContext extends BaseContext { userId: string; }`
 *
 * @param defaultContextDataForC An object containing the default properties and values
 *                               for your context type `C`. The `scope` property should
 *                               be omitted as it's managed internally by the `run` method.
 *                               Example: `{ userId: 'guest', tenantId: 'default' }`
 *
 ** @param asyncLocalStorage Optional. An `AsyncLocalStorage` constructor to use for
 *                          asynchronous context propagation. Defaults to the native
 *                          `node:async_hooks.AsyncLocalStorage`. Useful for testing
 *                          or providing polyfills in environments where the native
 *                          version is unavailable or needs to be mocked. If initialization
 *                          with the provided (or default) ALS fails, `unctx` will
 *                          fall back to a synchronous context propagation model for this instance.
 *
 * @returns A `ContextTools<C>` object containing:
 *   - `run`: Executes workflows within this specific context `C`.
 *   - `getContext` (and variants): Retrieves the active context `C`.
 *   - `defineTask`: Creates tasks strongly typed to expect context `C`.
 *   - `provide`: Creates nested scopes with temporary overrides within context `C`.
 *   - `inject` (and `injectOptional`): For dependency injection from context `C`.
 *
 * @example
 * ```typescript
 * import { createContext, defineTask, getContext, run, type BaseContext } from 'effectively';
 *
 * interface MyAppContext extends BaseContext {
 *   appName: string;
 *   logger: Console;
 * }
 *
 * const myAppTools = createContext<MyAppContext>({
 *   appName: 'MyAwesomeApp',
 *   logger: console,
 * });
 *
 * const GreetUserTask = myAppTools.defineTask(
 *   async (userName: string) => {
 *     const ctx = myAppTools.getContext(); // ctx is MyAppContext
 *     ctx.logger.info(`[${ctx.appName}] Preparing greeting for ${userName}`);
 *     return `Hello, ${userName} from ${ctx.appName}!`;
 *   }
 * );
 *
 * async function main() {
 *   const greeting = await myAppTools.run(GreetUserTask, "World");
 *   // myAppTools.logger.info(greeting); // Won't work directly, logger is on context
 *   console.log(greeting); // Output: Hello, World from MyAwesomeApp!
 *
 *   // Example of using provide with these specific tools
 *   await myAppTools.provide({ appName: "TempAppName" }, async () => {
 *     const tempGreeting = await myAppTools.run(GreetUserTask, "TempUser");
 *     console.log(tempGreeting); // Output: Hello, TempUser from TempAppName!
 *   });
 * }
 * main();
 * ```
 */
export function createContext<
  C extends BaseContext,
  G extends BaseContext = DefaultGlobalContext,
>(
  defaultContextDataForC: Omit<C, "scope">, // Initial default data for this specific context type
  asyncLocalStorage: typeof AsyncLocalStorage = AsyncLocalStorage,
): ContextTools<C> {
  // Each call to createContext gets its own unique unctx instance.
  let localUnctxInstance: ReturnType<typeof createUnctx<C>>;
  try {
    localUnctxInstance = createUnctx<C>({
      asyncContext: true,
      AsyncLocalStorage: asyncLocalStorage,
    });
  } catch (e) {
    console.warn(
      `[Effectively createContext for ${defaultContextDataForC?.constructor?.name || "C"}] AsyncLocalStorage not available or failed. Falling back to synchronous unctx. Context might not propagate as expected across all async boundaries for this instance.`,
    );
    localUnctxInstance = createUnctx<C>({ asyncContext: false });
  }

  // The default data for *this specific instance* of ContextTools.
  // It's Omit<C, 'scope'> because `scope` is added dynamically by `runSpecific`.
  const toolsDefaultContextData = defaultContextDataForC;

  // --- Methods for ContextTools<C> ---

  const getContextSpecific = (): C => {
    // ... (implementation as before, using localUnctxInstance)
    // ... (throw ContextNotFoundError if localUnctxInstance.use() is empty)
    try {
      const ctx = localUnctxInstance.use();
      if (!ctx) {
        throw new ContextNotFoundError(
          `Specific context (type: ${(toolsDefaultContextData as any)?.constructor?.name || "C"}) not found. ` +
            `Ensure getContext() is called within a run() or provide() scope managed by these specific tools.`,
        );
      }
      return ctx;
    } catch (error) {
      if (error instanceof ContextNotFoundError) throw error;
      throw new ContextNotFoundError(
        `Error retrieving specific context: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const getContextSafeSpecific = (): Result<C, ContextNotFoundError> => {
    // ... (implementation as before, using getContextSpecific)
    try {
      return ok(getContextSpecific());
    } catch (e) {
      return err(e as ContextNotFoundError);
    }
  };

  const getContextOrUndefinedSpecific = (): C | undefined => {
    // ... (implementation as before, using localUnctxInstance.use())
    try {
      return localUnctxInstance.use();
    } catch (error) {
      return undefined;
    }
  };

  const getContextOrGlobalSpecific = (): C | G => {
    const activeLocalContext = localUnctxInstance.use(); // Tries to get C_Specific

    if (activeLocalContext) {
      return activeLocalContext; // This is C_Specific
    }

    // Fallback to the *application's defined global default context object*.
    // The type G_AppGlobal ensures this is type-safe.
    // If globalContextInstanceForFallback was passed, use it, otherwise use the singleton.
    // For simplicity, let's stick to the singleton global for now.
    return getGlobalDefaultContextObjectSingleton() as G; // Cast might be needed if G_AppGlobal is more specific than DefaultGlobalContext
    // but if G_AppGlobal is DefaultGlobalContext, it's fine.
  };

  const defineTaskSpecific = <V, R>(
    fn: (value: V) => Promise<R>,
    taskNameOrOptions?: string | DefineTaskOptions,
  ): Task<C, V, R> => {
    return createTaskFunction<V, R, C, C>(fn, taskNameOrOptions);
  };
  async function provideSpecific<Pr>(
    overrides: Partial<
      Omit<C, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
        Record<string | symbol, any>
    >,
    fn: () => Promise<Pr>,
    options?: ProvideImplOptions,
  ): Promise<Pr> {
    // Correctly get the parent context without throwing.
    // This call happens *before* a new scope is established.
    const parentDataForProvide = localUnctxInstance.use();

    // If we are nested inside a `run` or another `provide` from the same tools,
    // `parentDataForProvide` will exist.
    if (parentDataForProvide) {
      return _INTERNAL_provideImpl<Pr, C, C>(
        localUnctxInstance,
        parentDataForProvide, // Use the active context as the parent
        overrides,
        fn,
        options,
      );
    } else {
      // This is a top-level `provide` call for these specific tools.
      // We must build a base context from the tool's defaults.
      const baseContextForThisProvide: C = {
        ...(toolsDefaultContextData as C),
        scope: { signal: new AbortController().signal }, // Create a root scope
      };

      return _INTERNAL_provideImpl<Pr, C, C>(
        localUnctxInstance,
        baseContextForThisProvide, // Use the default context as the parent
        overrides,
        fn,
        options,
      );
    }
  }
  async function _provideSpecific<Pr>(
    overrides: Partial<
      Omit<C, "scope" | typeof UNCTX_INSTANCE_SYMBOL> &
        Record<string | symbol, any>
    >,
    fn: () => Promise<Pr>,
    options?: ProvideImplOptions,
  ): Promise<Pr> {
    const parentDataForProvide = localUnctxInstance.use();

    // The key change is here. If there is no active context for this instance,
    // we build one from the defaults associated with *these tools*, not
    // from a wrongly detected ambient context.
    if (parentDataForProvide) {
      // We are nested inside a `run` or another `provide` from the same tools.
      // Correctly enhance the active context.
      return _INTERNAL_provideImpl<Pr, C, C>(
        localUnctxInstance,
        parentDataForProvide,
        overrides,
        fn,
        options,
      );
    } else {
      // This is the outermost call for this context. Use its own defaults as the base.
      const baseContextForThisProvide: C = {
        ...(toolsDefaultContextData as C),
        // Create a new root scope for this top-level provide.
        scope: { signal: new AbortController().signal },
      };

      return _INTERNAL_provideImpl<Pr, C, C>(
        localUnctxInstance,
        baseContextForThisProvide,
        overrides,
        fn,
        options,
      );
    }
  }
  /**
   * Executes a workflow exclusively within this specific context `C`.
   *
   * This function is bound to the context type `C` defined when `createContext<C>()`
   * was called. It uses the `defaultContextDataForC` provided at creation time
   * as its base, layers any `options.overrides` on top, and creates a new, unique
   * `scope` for each execution.
   *
   * @param workflow The Task or workflow to execute. It should be compatible with context `C`.
   * @param initialValue The initial input value for the workflow.
   * @param options Optional `RunOptions<C>` to control error handling, logging,
   *                context overrides, and parent cancellation signal.
   *
   * @returns A Promise resolving to `R` or `Result<R, WorkflowError>`.
   */
  async function runSpecific<V, R>(
    workflow: Task<C, V, R> | Task<any, V, R>,
    initialValue: V,
    options?: RunOptionsThrow<C>,
  ): Promise<R>;
  async function runSpecific<V, R>(
    workflow: Task<C, V, R> | Task<any, V, R>,
    initialValue: V,
    options: RunOptionsResult<C>,
  ): Promise<Result<R, WorkflowError>>;
  async function runSpecific<V, R>(
    workflow: Task<C, V, R> | Task<any, V, R>,
    initialValue: V,
    options: RunOptions<C> = {},
  ): Promise<R | Result<R, WorkflowError>> {
    const { overrides, parentSignal } = options;

    // 1. Create a new, cancellable scope for this specific run.
    const controller = new AbortController();
    const onParentAbort = () => controller.abort(parentSignal?.reason);

    if (parentSignal) {
      if (parentSignal.aborted) {
        onParentAbort(); // Abort immediately if parent is already aborted
      } else {
        parentSignal.addEventListener("abort", onParentAbort, { once: true });
      }
    }

    // Expose the controller on the scope for internal cleanup.
    const newScope: Scope & { controller: AbortController } = {
      signal: controller.signal,
      controller,
    };

    // 2. Construct the final, complete context object for THIS execution.
    // It starts with the defaults for this specific context instance,
    // layers any runtime overrides, and adds the newly created scope.
    const executionContext: C = {
      ...(toolsDefaultContextData as C), // Base properties for this context type
      ...(overrides as Partial<C>), // Runtime overrides for this specific run
      scope: newScope, // The new scope always overrides any default
    };

    // Tag the context object with its managing unctx instance for discovery by nested calls.
    Object.defineProperty(executionContext, UNCTX_INSTANCE_SYMBOL, {
      value: localUnctxInstance,
      enumerable: false,
      writable: false,
      configurable: true,
    });

    // Explicitly copy any symbol-keyed properties from overrides.
    if (overrides) {
      Object.getOwnPropertySymbols(overrides).forEach((symKey) => {
        (executionContext as any)[symKey] = (overrides as any)[symKey];
      });
    }

    // 3. Call the internal run implementation with the fully constructed context.
    return runImpl<V, R, C, C>(
      localUnctxInstance,
      workflow as Task<C, V, R>, // We can now safely assert the workflow is compatible with C
      initialValue,
      executionContext, // Pass the final, constructed object.
      options,
    ).finally(() => {
      // Clean up event listener after the run is completely finished.
      if (parentSignal) {
        parentSignal.removeEventListener("abort", onParentAbort);
      }
    });
  }

  const injectSpecific = <T>(token: InjectionToken<T>): T => {
    // ... (implementation as before, using getContextSpecific)
    const context = getContextSpecific();
    const value = (context as any)[token as symbol];
    if (value === undefined) {
      throw new Error(
        `[ContextTools(${(toolsDefaultContextData as any)?.constructor?.name || "C"})] Injection token ${token.toString()} not found.`,
      );
    }
    return value as T;
  };

  const injectOptionalSpecific = <T>(
    token: InjectionToken<T>,
  ): T | undefined => {
    // ... (implementation as before, using getContextSpecific)
    try {
      const context = getContextSpecific();
      return (context as any)[token as symbol] as T | undefined;
    } catch {
      return undefined;
    }
  };

  return {
    run: runSpecific,
    getContext: getContextSpecific,
    getContextSafe: getContextSafeSpecific,
    getContextOrUndefined: getContextOrUndefinedSpecific,
    getContextOrGlobal: getContextOrGlobalSpecific,
    defineTask: defineTaskSpecific,
    provide: provideSpecific,
    inject: injectSpecific,
    injectOptional: injectOptionalSpecific,
  } as ContextTools<C, G>;
}
