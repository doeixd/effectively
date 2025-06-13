// Re-export context management functions for backward compatibility
export {
  createContext,
  mergeContexts,
  validateContext,
  requireContextProperties,
  useContextProperty,
  withContextEnhancement,
  createInjectionToken,
  inject,
  injectOptional,
  // Smart context functions
  defineTask,
  getContext,
  getContextSafe,
  getContextOrUndefined,
  run,
  provide,
  // Local-only context functions
  defineTaskLocal,
  getContextLocal,
  getContextSafeLocal,
  getContextOrUndefinedLocal,
  runLocal,
  provideLocal,
  // Global-only context functions
  defineTaskGlobal,
  getContextGlobal,
  runGlobal,
  provideGlobal,
  type ContextTools,
  type BaseContext,
  type ContextSchema,
  type InjectionToken,
  type MergeContexts
} from './run';

// /**
//  * Retrieves the current context with explicit unctx parameter. Used internally.
//  * @throws {ContextNotFoundError} If called outside of a `run` execution.
//  */
// function getContextWithUnctx<C extends BaseContext>(unctx?: ReturnType<typeof createUnctx<C>>): C {
//   const instance = unctx || detectUnctxInstance<C>();
//   const ctx = instance.use();
//   if (!ctx) throw new ContextNotFoundError();
//   return ctx;
// }

// /**
//  * Retrieves the current context as a `Result` type with explicit unctx parameter. Used internally.
//  * @returns {Result<C, ContextNotFoundError>} `Ok` with context or `Err` if not found.
//  */
// function getContextSafeWithUnctx<C extends BaseContext>(unctx?: ReturnType<typeof createUnctx<C>>): Result<C, ContextNotFoundError> {
//   const instance = unctx || getGlobalUnctx<C>();
//   const ctx = instance.use();
//   if (!ctx) {
//     return { isOk: () => false, isErr: () => true, error: new ContextNotFoundError() } as Err<C, ContextNotFoundError>;
//   }
//   return { isOk: () => true, isErr: () => false, value: ctx } as Ok<C, ContextNotFoundError>;
// }

// /**
//  * Retrieves the current context or `undefined` with explicit unctx parameter. Used internally.
//  * @returns The context object or `undefined`.
//  */
// function getContextOrUndefinedWithUnctx<C extends BaseContext>(unctx?: ReturnType<typeof createUnctx<C>>): C | undefined {
//   const instance = unctx || detectUnctxInstance<C>();
//   try {
//     return instance.use();
//   } catch (error) {
//     // If context is not available, return undefined as the function name suggests
//     return undefined;
//   }
// }

// /**
//  * Defines a function as a `Task` with explicit context type parameter. Used internally.
//  *
//  * @param fn The core logic of the task, accepting a value and returning a promise.
//  * @returns A `Task` function that can be used in a workflow.
//  */
// function defineTaskWithContext<C extends BaseContext, V, R>(
//   fn: (value: V) => Promise<R>
// ): Task<C, V, R> {
//   const taskFn = (context: C, value: V): Promise<R> => fn(value);
//   Object.defineProperty(taskFn, 'name', { value: fn.name || 'anonymous', configurable: true });
//   Object.defineProperty(taskFn, '__task_id', { value: Symbol(`task_${fn.name || 'anonymous'}`), configurable: true, enumerable: false, writable: false });
//   return taskFn as Task<C, V, R>;
// }

// function getContextOrUndefinedWithOptionalUnctx<C extends BaseContext>(
//   explicitUnctxInstance?: ReturnType<typeof createUnctx<C>>
// ): C | undefined {
//   const instanceToUse = explicitUnctxInstance || detectActiveOrDefaultUnctxInstance(); // Uses revised detector
//   try {
//     // The instanceToUse could be for DefaultGlobalContext or a specific C.
//     // The cast to C is an assertion by the caller of this helper.
//     return instanceToUse.use() as C | undefined;
//   } catch (error) {
//     console.warn("[Effectively Internal] Error calling 'use()' in getContextOrUndefinedWithOptionalUnctx.", error);
//     return undefined;
//   }
// }

/**
 * Gets or creates the default global context instance
 */
// function getDefaultGlobalContext(): ContextTools<DefaultGlobalContext> {
//   if (!globalThis[DEFAULT_GLOBAL_CONTEXT_KEY]) {
//     globalThis[DEFAULT_GLOBAL_CONTEXT_KEY] = createContext<DefaultGlobalContext>({});
//   }
//   return globalThis[DEFAULT_GLOBAL_CONTEXT_KEY]!;
// }

/**
 * Internal Helper: Detects the appropriate unctx instance to use.
 * Prioritizes the currently active specific unctx instance.
 * If no specific instance is active, it falls back to the global unctx instance.
 * This function itself does not *use* the instance, it just returns it.
 */
// function detectUnctxInstance<C extends BaseContext>(): ReturnType<typeof createUnctx<C>> {
//   // If `_INTERNAL_getCurrentUnctxInstance()` (which reads `currentUnctxInstance`)
//   // returns a non-null value, it means a specific context's `run` or `provide`
//   // is currently managing the async flow. Use that instance.
//   const activeSpecificUnctx = _INTERNAL_getCurrentUnctxInstance();
//   if (activeSpecificUnctx) {
//     return activeSpecificUnctx as ReturnType<typeof createUnctx<C>>;
//   }

//   // Otherwise, no specific context is active; fall back to the global unctx instance.
//   // `getGlobalUnctxInstanceSingleton()` (renamed from your `getGlobalUnctx`)
//   // should return `ReturnType<typeof createUnctx<DefaultGlobalContext>>`.
//   // The cast to `ReturnType<typeof createUnctx<C>>` here is an assertion.
//   return getGlobalUnctx() as ReturnType<typeof createUnctx<C>>;
// }

// /**
//  * Internal Helper: Detects the appropriate unctx instance to use.
//  * Prioritizes the currently active specific unctx instance.
//  * If no specific instance is active, it falls back to the global unctx instance.
//  */
// function detectActiveOrDefaultUnctxInstance(): ReturnType<typeof createUnctx<any>> {
//   const activeSpecificUnctx = _INTERNAL_getCurrentUnctxInstance();
//   if (activeSpecificUnctx) {
//     return activeSpecificUnctx;
//   }
//   return getGlobalUnctx(); // This returns ReturnType<typeof createUnctx<DefaultGlobalContext>>
//   // which is assignable to ReturnType<typeof createUnctx<any>>
// }
