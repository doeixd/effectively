/**
 * Context Utils - Type-Safe Composable Primitives for Effectively
 * 
 * This module provides essential, composable primitives for context manipulation
 * that integrate seamlessly with Effectively's context system. Each primitive is:
 * - Fully type-safe with precise inference
 * - Composable with flow/pipe/chain utilities
 * - Available in both curried and direct forms
 * - Compatible with both createContext tools and smart global functions
 */

import type {
  BaseContext,
  ContextTools,
  Task,
  RunOptions,
  ProvideImplOptions
} from './run';
import { flow } from './utils'; // Assuming you have flow/pipe utilities

// =============================================================================
// Core Types for Context Manipulation
// =============================================================================

/**
 * A context transformer function that takes a context and returns a modified version.
 * Both input and output must extend BaseContext (contain scope property).
 */
export type ContextTransformer<TFrom extends BaseContext, TTo extends BaseContext> =
  (context: TFrom) => TTo;

/**
 * A curried context transformer that can be used with flow/pipe.
 * Ensures the result always extends BaseContext.
 */
export type CurriedContextTransformer<TTo extends BaseContext> =
  <TFrom extends BaseContext>(context: TFrom) => TFrom & TTo;

/**
 * Configuration for creating context-bound utilities.
 */
export interface ContextConfig<C extends BaseContext> {
  getContext: () => C;
  provide: <R>(
    overrides: Partial<Omit<C, 'scope'> & Record<string | symbol, any>>,
    fn: () => Promise<R>,
    options?: ProvideImplOptions
  ) => Promise<R>;
  run: <V, R>(task: Task<C, V, R>, value: V, options?: RunOptions<C>) => Promise<R>;
}

export type ExtractProvideSignature<T> = T extends ContextTools<infer C>
  ? T['provide']
  : never;

// Extract the overrides parameter type
export type ExtractProvideOverrides<T> = T extends ContextTools<infer C>
  ? Parameters<T['provide']>[0]
  : never;

/**
* Creates a type-safe configuration wrapper for ContextTools.
* This handles the complex type matching between ContextTools and our utilities.
*/
function createContextConfig<C extends BaseContext>(
  contextSystem: ContextTools<C>
): ContextConfig<C> {
  return {
    getContext: contextSystem.getContext,
    provide: contextSystem.provide as any, // Type-safe wrapper
    run: contextSystem.run as any // Type-safe wrapper
  };
}

  
/**
 * Creates context-bound primitives with maximum type safety from ContextTools.
 * This is the primary utility for creating a complete set of context manipulation
 * functions that are bound to a specific ContextTools instance.
 * 
 * @template C The BaseContext type that the ContextTools operates on
 * @param contextSystem The ContextTools instance from createContext()
 * @returns Complete set of context-bound utilities with full type safety
 * 
 * @example
 * ```typescript
 * interface UserContext extends BaseContext {
 *   userId: string;
 *   permissions: string[];
 *   sessionId: string;
 * }
 * 
 * const contextSystem = createContext<UserContext>({
 *   userId: 'guest',
 *   permissions: ['read'],
 *   sessionId: ''
 * });
 * 
 * // Create context-bound primitives
 * const primitives = createContextPrimitives(contextSystem);
 * 
 * // Use with perfect type safety
 * const enhanceUserSession = flow(
 *   primitives.set('userId', 'user-123'),
 *   primitives.update('permissions', perms => [...perms, 'write']),
 *   primitives.extend({ sessionId: crypto.randomUUID() }),
 *   primitives.when(
 *     ctx => ctx.permissions.includes('admin'), 
 *     { adminAccess: true }
 *   )
 * );
 * 
 * // Execute with context modifications
 * await primitives.scope(enhanceUserSession, async () => {
 *   const userData = await primitives.run(fetchUserTask, userId);
 *   return userData;
 * });
 * ```
 */
export function createContextPrimitives<C extends BaseContext>(
  contextSystem: ContextTools<C>
): {
  // Core transformers - Functions that modify context and return new context
  /** Extends context with additional properties, preserving all existing ones */
  extend: ReturnType<typeof createBoundExtend<C>>;
  /** Selects only specified properties from context (always preserves 'scope') */
  pick: ReturnType<typeof createBoundPick<C>>;
  /** Removes specified properties from context (cannot remove 'scope') */
  omit: ReturnType<typeof createBoundOmit<C>>;
  /** Sets a single property with excellent type inference */
  set: ReturnType<typeof createBoundSet<C>>;
  /** Updates an existing property using a transformer function */
  update: ReturnType<typeof createBoundUpdate<C>>;
  /** Conditionally applies context modifications based on a predicate */
  when: ReturnType<typeof createBoundWhen<C>>;
  /** Applies arbitrary transformation to the entire context */
  transform: ReturnType<typeof createBoundTransform<C>>;
  /** Deep merges contexts with optional conflict resolution */
  merge: ReturnType<typeof createBoundMerge<C>>;

  // Execution utilities - Functions that run code with modified context
  /** Executes a function with temporarily modified context */
  scope: ReturnType<typeof createBoundScope<C>>;
  /** Executes a task with modified context */
  exec: ReturnType<typeof createBoundExec<C>>;

  // Context access - Direct access to the underlying ContextTools
  /** Gets the current context (same as contextSystem.getContext) */
  getContext: () => C;
  /** Creates nested scope with overrides (same as contextSystem.provide) */
  provide: ContextTools<C>['provide'];
  /** Runs a task in this context (same as contextSystem.run) */
  run: ContextTools<C>['run'];
} {
  // Create a type-safe configuration wrapper
  const config = createContextConfig(contextSystem);

  return {
    // Create all the context-bound transformers using the config
    // These functions will automatically use the correct context type C
    extend: createBoundExtend(config),
    pick: createBoundPick(config),
    omit: createBoundOmit(config),
    set: createBoundSet(config),
    update: createBoundUpdate(config),
    when: createBoundWhen(config),
    transform: createBoundTransform(config),
    merge: createBoundMerge(config),

    // Create execution utilities
    scope: createBoundScope(config),
    exec: createBoundExec(config),

    // Pass through the original ContextTools functions for direct access
    getContext: contextSystem.getContext,
    provide: contextSystem.provide,
    run: contextSystem.run
  };
}



// =============================================================================
// 1. EXTEND - Add properties to context
// =============================================================================

/**
 * Extends a context with additional properties. The most fundamental operation
 * for context building. Provides excellent type inference for new properties.
 * 
 * @example
 * ```typescript
 * // Direct usage
 * const enhanced = extend({ userId: '123', debug: true })(baseContext);
 * 
 * // Composition with flow
 * const buildUserContext = flow(
 *   extend({ userId: '123' }),
 *   extend({ sessionId: 'abc' }),
 *   extend({ timestamp: Date.now() })
 * );
 * 
 * // Type inference: BaseContext & { userId: string, sessionId: string, timestamp: number }
 * const userContext = buildUserContext(baseContext);
 * ```
 */
export function extend<TExtension extends Record<string, any>>(
  extension: TExtension
): <TContext extends BaseContext>(context: TContext) => TContext & TExtension {
  return <TContext extends BaseContext>(context: TContext) => ({
    ...context,
    ...extension
  });
}

/**
 * Context-bound version of extend that uses the current context from ContextTools.
 */
export function createBoundExtend<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundExtend<TExtension extends Record<string, any>>(
    extension: TExtension
  ): (context?: C) => C & TExtension {
    return (context?: C) => {
      const ctx = context || config.getContext();
      return { ...ctx, ...extension };
    };
  };
}

// =============================================================================
// 2. PICK - Select specific properties
// =============================================================================

/**
 * Creates a new context containing only the specified properties.
 * Essential for creating focused contexts and limiting scope.
 * Always preserves the required 'scope' property from BaseContext.
 * 
 * @example
 * ```typescript
 * // Select only core services (scope is automatically preserved)
 * const coreContext = pick(['api', 'db', 'logger'])(fullContext);
 * 
 * // Composition for progressive refinement
 * const buildMinimalContext = flow(
 *   pick(['api', 'db']),               // Keep only essential services + scope
 *   extend({ environment: 'test' }),   // Add test environment
 *   extend({ mockMode: true })         // Add test flags
 * );
 * 
 * // Type: Pick<FullContext, 'api' | 'db' | 'scope'> & { environment: string, mockMode: boolean }
 * ```
 */
export function pick<K extends string>(
  keys: readonly K[]
): <TContext extends BaseContext & Record<K, any>>(
  context: TContext
) => Pick<TContext, K | 'scope'> & BaseContext {
  return <TContext extends BaseContext & Record<K, any>>(context: TContext) => {
    const result = { scope: context.scope } as Pick<TContext, K | 'scope'> & BaseContext;
    for (const key of keys) {
      if (key in context && key !== 'scope') {
        (result as any)[key] = context[key];
      }
    }
    return result;
  };
}

/**
 * Context-bound version of pick.
 */
export function createBoundPick<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundPick<K extends keyof C>(
    keys: readonly K[]
  ): (context?: C) => Pick<C, K | 'scope'> {
    return (context?: C) => {
      const ctx = context || config.getContext();
      const result = { scope: ctx.scope } as Pick<C, K | 'scope'>;
      for (const key of keys) {
        if (key in ctx && key !== 'scope') {
          (result as any)[key] = ctx[key];
        }
      }
      return result;
    };
  };
}

// =============================================================================
// 3. OMIT - Remove specific properties
// =============================================================================

/**
 * Creates a new context with specified properties removed.
 * Essential for removing sensitive data or simplifying context.
 * The 'scope' property cannot be omitted and is always preserved.
 * 
 * @example
 * ```typescript
 * // Remove sensitive data before external API calls (scope preserved)
 * const safeContext = omit(['password', 'apiKey', 'secrets'])(userContext);
 * 
 * // Progressive cleanup
 * const cleanContext = flow(
 *   omit(['cache', 'metrics']),        // Remove non-essential services
 *   omit(['debugTools']),              // Remove debug utilities  
 *   extend({ readonly: true })         // Mark as readonly
 * );
 * 
 * // ❌ This would cause a compile error:
 * // omit(['scope']) // Cannot omit required BaseContext properties
 * ```
 */
export function omit<K extends string>(
  keys: readonly K[]
): <TContext extends BaseContext>(
  context: TContext
) => Omit<TContext, K> & BaseContext {
  return <TContext extends BaseContext>(context: TContext) => {
    const result = { ...context };
    for (const key of keys) {
      // Prevent omitting scope - it's required by BaseContext
      if (key !== 'scope') {
        delete (result as any)[key];
      }
    }
    return result as Omit<TContext, K> & BaseContext;
  };
}

/**
 * Context-bound version of omit.
 */
export function createBoundOmit<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundOmit<K extends keyof C>(
    keys: readonly K[]
  ): (context?: C) => Omit<C, K> {
    return (context?: C) => {
      const ctx = context || config.getContext();
      const result = { ...ctx };
      for (const key of keys) {
        if (key !== 'scope') {
          delete result[key];
        }
      }
      return result as Omit<C, K>;
    };
  };
}

// =============================================================================
// 4. SET - Set a single property
// =============================================================================

/**
 * Sets a single property in the context with excellent type inference.
 * More focused than extend for single-value operations.
 * 
 * @example
 * ```typescript
 * // Chain multiple property sets
 * const sessionContext = flow(
 *   set('userId', '123'),
 *   set('sessionId', crypto.randomUUID()),
 *   set('startTime', Date.now()),
 *   set('environment', 'production' as const)  // Literal type preserved
 * )(baseContext);
 * 
 * // Type: BaseContext & { userId: string, sessionId: string, startTime: number, environment: 'production' }
 * ```
 */
export function set<K extends string, V>(
  key: K,
  value: V
): <TContext extends BaseContext>(
  context: TContext
) => TContext & Record<K, V> {
  return <TContext extends BaseContext>(context: TContext) => ({
    ...context,
    [key]: value
  } as TContext & Record<K, V>);
}

/**
 * Context-bound version of set.
 */
export function createBoundSet<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundSet<K extends string, V>(
    key: K,
    value: V
  ): (context?: C) => C & Record<K, V> {
    return (context?: C) => {
      const ctx = context || config.getContext();
      return { ...ctx, [key]: value } as C & Record<K, V>;
    };
  };
}

// =============================================================================
// 5. UPDATE - Transform a property with a function
// =============================================================================

/**
 * Updates an existing property using a transformer function.
 * Perfect for counters, arrays, conditional updates, and object modifications.
 * 
 * @example
 * ```typescript
 * // Increment retry counter
 * const withRetry = update('retryCount', (count: number) => count + 1);
 * 
 * // Add item to array
 * const addPermission = update('permissions', (perms: string[]) => [...perms, 'admin']);
 * 
 * // Complex object updates
 * const updateUser = update('user', (user: User) => ({
 *   ...user,
 *   lastSeen: Date.now(),
 *   loginCount: user.loginCount + 1
 * }));
 * 
 * // Chain updates
 * const enhanceSession = flow(
 *   update('retryCount', (n: number) => n + 1),
 *   update('lastActivity', () => Date.now()),
 *   update('config', (cfg: Config) => ({ ...cfg, timeout: cfg.timeout * 2 }))
 * );
 * ```
 */
export function update<K extends string, TCurrentValue, TNewValue>(
  key: K,
  updater: (current: TCurrentValue) => TNewValue
): <TContext extends BaseContext & Record<K, TCurrentValue>>(
  context: TContext
) => Omit<TContext, K> & Record<K, TNewValue> {
  return <TContext extends BaseContext & Record<K, TCurrentValue>>(context: TContext) => {
    const newValue = updater(context[key]);
    return {
      ...context,
      [key]: newValue
    } as Omit<TContext, K> & Record<K, TNewValue>;
  };
}

/**
 * Context-bound version of update with enhanced type safety.
 */
export function createBoundUpdate<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundUpdate<K extends keyof C, TNewValue>(
    key: K,
    updater: (current: C[K]) => TNewValue
  ): (context?: C) => Omit<C, K> & Record<K, TNewValue> {
    return (context?: C) => {
      const ctx = context || config.getContext();
      const newValue = updater(ctx[key]);
      return {
        ...ctx,
        [key]: newValue
      } as Omit<C, K> & Record<K, TNewValue>;
    };
  };
}

// =============================================================================
// 6. WHEN - Conditional context modification
// =============================================================================

/**
 * Conditionally applies context modifications based on a predicate.
 * Essential for environment-specific, feature-flag driven, or conditional logic.
 * 
 * @example
 * ```typescript
 * // Environment-based configuration
 * const configureEnv = flow(
 *   when((ctx: AppContext) => ctx.environment === 'development', { 
 *     debug: true, 
 *     verbose: true,
 *     mockData: true 
 *   }),
 *   when((ctx: AppContext) => ctx.environment === 'production', { 
 *     monitoring: true, 
 *     rateLimiting: true 
 *   }),
 *   when((ctx: AppContext) => ctx.userRole === 'admin', { 
 *     adminTools: true,
 *     permissions: 'all' as const
 *   })
 * );
 * 
 * // Feature flags
 * const enableFeatures = when(
 *   (ctx: AppContext) => ctx.features?.experimentalUI === true,
 *   { uiVersion: 'v2' as const, betaFeatures: true }
 * );
 * ```
 */
export function when<TCondition extends Record<string, any>>(
  condition: boolean,
  additions: TCondition
): <TContext extends BaseContext>(context: TContext) => TContext | (TContext & TCondition);
export function when<TCondition extends Record<string, any>>(
  condition: <TContext extends BaseContext>(ctx: TContext) => boolean,
  additions: TCondition
): <TContext extends BaseContext>(context: TContext) => TContext | (TContext & TCondition);
export function when<TCondition extends Record<string, any>>(
  condition: boolean | (<TContext extends BaseContext>(ctx: TContext) => boolean),
  additions: TCondition
): <TContext extends BaseContext>(context: TContext) => TContext | (TContext & TCondition) {
  return <TContext extends BaseContext>(context: TContext) => {
    const shouldAdd = typeof condition === 'function' ? condition(context) : condition;
    return shouldAdd ? { ...context, ...additions } : context;
  };
}

/**
 * Context-bound version of when.
 */
export function createBoundWhen<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundWhen<TCondition extends Record<string, any>>(
    condition: boolean | ((ctx: C) => boolean),
    additions: TCondition
  ): (context?: C) => C | (C & TCondition) {
    return (context?: C) => {
      const ctx = context || config.getContext();
      const shouldAdd = typeof condition === 'function' ? condition(ctx) : condition;
      return shouldAdd ? { ...ctx, ...additions } : ctx;
    };
  };
}

// =============================================================================
// 7. TRANSFORM - Apply arbitrary transformation
// =============================================================================

/**
 * Applies an arbitrary transformation function to the entire context.
 * The most flexible primitive for complex context modifications and restructuring.
 * 
 * @example
 * ```typescript
 * // Add computed properties
 * const addComputedProps = transform((ctx: UserContext) => ({
 *   ...ctx,
 *   fullName: `${ctx.firstName} ${ctx.lastName}`,
 *   isAdmin: ctx.roles.includes('admin'),
 *   sessionAge: Date.now() - ctx.sessionStart,
 *   permissions: computePermissions(ctx.roles)
 * }));
 * 
 * // Restructure legacy context
 * const modernizeContext = transform((legacy: LegacyContext) => ({
 *   scope: legacy.scope,
 *   user: { 
 *     id: legacy.userId, 
 *     name: legacy.userName,
 *     email: legacy.userEmail 
 *   },
 *   services: { 
 *     api: legacy.apiClient, 
 *     db: legacy.database,
 *     cache: legacy.cacheService
 *   },
 *   config: { 
 *     debug: legacy.debugMode, 
 *     env: legacy.environment,
 *     timeout: legacy.requestTimeout
 *   }
 * }));
 * 
 * // Complex conditional transformations
 * const smartTransform = transform((ctx: RequestContext) => {
 *   const base = { ...ctx };
 *   
 *   if (ctx.userRole === 'admin') {
 *     return { 
 *       ...base, 
 *       adminTools: createAdminTools(), 
 *       permissions: 'all' as const,
 *       auditLog: createAuditLogger()
 *     };
 *   }
 *   
 *   if (ctx.environment === 'development') {
 *     return { 
 *       ...base, 
 *       debugTools: createDebugTools(), 
 *       mockData: true,
 *       profiler: createProfiler()
 *     };
 *   }
 *   
 *   return base;
 * });
 * ```
 */
export function transform<TFrom extends BaseContext, TTo extends BaseContext>(
  transformer: (context: TFrom) => TTo
): (context: TFrom) => TTo {
  return transformer;
}

/**
 * Context-bound version of transform.
 */
export function createBoundTransform<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundTransform<TResult extends BaseContext>(
    transformer: (context: C) => TResult
  ): (context?: C) => TResult {
    return (context?: C) => {
      const ctx = context || config.getContext();
      return transformer(ctx);
    };
  };
}

// =============================================================================
// 8. SCOPE - Execute function with modified context
// =============================================================================

/**
 * Executes a function within a modified context scope. The context changes
 * are temporary and only apply to the function execution and any nested operations.
 * 
 * @example
 * ```typescript
 * // Execute with enhanced context
 * await scope(
 *   flow(
 *     extend({ userId: '123' }),
 *     set('debug', true),
 *     omit(['cache'])
 *   ),
 *   async () => {
 *     // All tasks here see the modified context
 *     const user = await run(fetchUserTask, userId);
 *     const profile = await run(fetchProfileTask, user.id);
 *     return processUserData(user, profile);
 *   }
 * );
 * 
 * // Nested scopes work correctly
 * await scope(extend({ level: 1 }), async () => {
 *   console.log(getContext().level); // 1
 *   
 *   await scope(set('level', 2), async () => {
 *     console.log(getContext().level); // 2
 *   });
 *   
 *   console.log(getContext().level); // 1 (restored)
 * });
 * ```
 */
export function scope<
  TFrom extends BaseContext,
  TTo extends BaseContext,
  R
>(
  contextModifier: ContextTransformer<TFrom, TTo>,
  fn: () => Promise<R>
): (context: TFrom, provide: ContextConfig<any>['provide']) => Promise<R> {
  return async (context: TFrom, provide: ContextConfig<any>['provide']) => {
    const modifiedContext = contextModifier(context);
    // Extract only the properties that can be overridden (exclude scope)
    const overrides = Object.keys(modifiedContext).reduce((acc, key) => {
      if (key !== 'scope') {
        acc[key] = (modifiedContext as any)[key];
      }
      return acc;
    }, {} as any);

    return provide(overrides, fn);
  };
}

/**
 * Context-bound version of scope.
 */
export function createBoundScope<C extends BaseContext>(config: ContextConfig<C>) {
  return async function boundScope<TResult extends BaseContext, R>(
    contextModifier: ContextTransformer<C, TResult>,
    fn: () => Promise<R>,
    context?: C
  ): Promise<R> {
    const ctx = context || config.getContext();
    const modifiedContext = contextModifier(ctx);

    // Extract overrides (everything except scope)
    const overrides = Object.keys(modifiedContext).reduce((acc, key) => {
      if (key !== 'scope') {
        acc[key] = (modifiedContext as any)[key];
      }
      return acc;
    }, {} as any);

    return config.provide(overrides, fn);
  };
}

// =============================================================================
// 9. EXEC - Execute task with modified context
// =============================================================================

/**
 * Executes a specific task with a modified context. Context modifications
 * are scoped only to this task execution.
 * 
 * @example
 * ```typescript
 * // Run task with enhanced context
 * const user = await exec(
 *   flow(
 *     extend({ requestId: crypto.randomUUID() }),
 *     set('tracing', true),
 *     set('timeout', 30000)
 *   ),
 *   fetchUserTask,
 *   userId
 * );
 * 
 * // Context modifications are isolated
 * const result = await exec(
 *   flow(
 *     set('retryCount', 3),
 *     omit(['cache']),      // Disable cache for this task only
 *     extend({ mockMode: true })
 *   ),
 *   riskyNetworkTask,
 *   requestData
 * );
 * ```
 */
export function exec<
  TFrom extends BaseContext,
  TTo extends BaseContext,
  V,
  R
>(
  contextModifier: ContextTransformer<TFrom, TTo>,
  task: Task<TTo, V, R>,
  value: V
): (context: TFrom, run: ContextConfig<any>['run']) => Promise<R> {
  return async (context: TFrom, run: ContextConfig<any>['run']) => {
    const modifiedContext = contextModifier(context);

    // Extract overrides for the run options
    const overrides = Object.keys(modifiedContext).reduce((acc, key) => {
      if (key !== 'scope') {
        acc[key] = (modifiedContext as any)[key];
      }
      return acc;
    }, {} as any);

    return run(task as any, value, { overrides });
  };
}

/**
 * Context-bound version of exec.
 */
export function createBoundExec<C extends BaseContext>(config: ContextConfig<C>) {
  return async function boundExec<TResult extends BaseContext, V, R>(
    contextModifier: ContextTransformer<C, TResult>,
    task: Task<TResult, V, R>,
    value: V,
    context?: C
  ): Promise<R> {
    const ctx = context || config.getContext();
    const modifiedContext = contextModifier(ctx);

    // Extract overrides
    const overrides = Object.keys(modifiedContext).reduce((acc, key) => {
      if (key !== 'scope') {
        acc[key] = (modifiedContext as any)[key];
      }
      return acc;
    }, {} as any);

    return config.run(task as any, value, { overrides });
  };
}

// =============================================================================
// 10. MERGE - Deep merge contexts
// =============================================================================

/**
 * Performs deep merging of contexts, recursively combining nested objects.
 * Essential for complex context structures with nested configuration.
 * 
 * @example
 * ```typescript
 * // Deep merge preserves nested structure
 * const baseConfig = {
 *   scope: { signal: controller.signal },
 *   api: { timeout: 5000, retries: 3, baseUrl: 'https://api.example.com' },
 *   features: { featureA: true, featureB: false, featureC: { enabled: true, beta: false } },
 *   database: { host: 'localhost', port: 5432, ssl: false }
 * };
 * 
 * const enhanced = merge({
 *   api: { timeout: 10000 },              // Only timeout changes, retries and baseUrl preserved
 *   features: { 
 *     featureC: { beta: true },           // Only beta changes, enabled preserved
 *     featureD: true                      // New feature added
 *   },
 *   database: { ssl: true },              // Only ssl changes, host and port preserved
 *   newService: { enabled: true }         // Completely new service
 * })(baseConfig);
 * 
 * // Result preserves structure:
 * // {
 * //   scope: { signal: ... },
 * //   api: { timeout: 10000, retries: 3, baseUrl: 'https://api.example.com' },
 * //   features: { 
 * //     featureA: true, 
 * //     featureB: false, 
 * //     featureC: { enabled: true, beta: true },
 * //     featureD: true 
 * //   },
 * //   database: { host: 'localhost', port: 5432, ssl: true },
 * //   newService: { enabled: true }
 * // }
 * 
 * // Custom conflict resolution
 * const withCustomMerging = merge(
 *   { tags: ['new', 'feature'] },
 *   (key, existing, incoming) => {
 *     if (key === 'tags' && Array.isArray(existing) && Array.isArray(incoming)) {
 *       return [...existing, ...incoming]; // Concatenate arrays
 *     }
 *     return incoming; // Default: incoming wins
 *   }
 * );
 * ```
 */
export function merge<TOther extends Record<string, any>>(
  other: TOther,
  resolver?: (key: string, contextValue: any, otherValue: any) => any
): <TContext extends BaseContext>(context: TContext) => TContext & TOther {
  return <TContext extends BaseContext>(context: TContext) => {
    return deepMerge(context, other, resolver);
  };
}

/**
 * Context-bound version of merge.
 */
export function createBoundMerge<C extends BaseContext>(config: ContextConfig<C>) {
  return function boundMerge<TOther extends Record<string, any>>(
    other: TOther,
    resolver?: (key: string, contextValue: any, otherValue: any) => any
  ): (context?: C) => C & TOther {
    return (context?: C) => {
      const ctx = context || config.getContext();
      return deepMerge(ctx, other, resolver);
    };
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Deep merge implementation that recursively combines objects.
 */
function deepMerge<T extends object, U extends object>(
  target: T,
  source: U,
  resolver?: (key: string, targetValue: any, sourceValue: any) => any
): T & U {
  const result = { ...target } as any;

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      const sourceValue = source[key];
      const targetValue = result[key];

      if (resolver && key in target) {
        result[key] = resolver(key, targetValue, sourceValue);
      } else if (isObject(sourceValue) && isObject(targetValue)) {
        result[key] = deepMerge(targetValue, sourceValue, resolver);
      } else {
        result[key] = sourceValue;
      }
    }
  }

  return result;
}

/**
 * Type guard for plain objects.
 */
function isObject(item: any): item is Record<string, any> {
  return item && typeof item === 'object' && !Array.isArray(item);
}

// =============================================================================
// Usage Examples and Patterns
// =============================================================================

/*
// =============================================================================
// Example 1: Basic Context Building Pipeline
// =============================================================================

interface UserSessionContext extends BaseContext {
  userId: string;
  sessionId: string;
  environment: 'development' | 'production' | 'test';
  permissions: string[];
  config: {
    timeout: number;
    retries: number;
  };
}

const { run, provide, getContext } = createContext<UserSessionContext>({
  userId: 'guest',
  sessionId: '',
  environment: 'development',
  permissions: ['read'],
  config: {
    timeout: 5000,
    retries: 3
  }
});

// Create context-bound utilities
const ctx = createContextUtils({ getContext, provide, run });

// Build user session context
const buildUserSession = flow(
  ctx.set('userId', 'user-123'),
  ctx.set('sessionId', crypto.randomUUID()),
  ctx.update('permissions', (perms: string[]) => [...perms, 'write', 'delete']),
  ctx.when(c => c.environment === 'development', { 
    debugMode: true, 
    verboseLogging: true 
  }),
  ctx.merge({
    config: { timeout: 10000 } // Deep merges with existing config
  })
);

const userContext = buildUserSession(baseContext);

// =============================================================================
// Example 2: Environment-Specific Configuration
// =============================================================================

const environmentConfigs = createEnvironmentConfig({
  development: flow(
    ctx.set('environment', 'development' as const),
    ctx.extend({ 
      debug: true,
      mockServices: true,
      hotReload: true 
    }),
    ctx.merge({
      config: { 
        timeout: 30000,    // Longer timeouts for debugging
        retries: 1         // Fewer retries for faster feedback
      }
    }),
    ctx.omit(['productionDb', 'realPaymentProcessor'])
  ),

  production: flow(
    ctx.set('environment', 'production' as const),
    ctx.extend({ 
      monitoring: true,
      rateLimiting: true,
      errorReporting: true 
    }),
    ctx.merge({
      config: { 
        timeout: 5000,
        retries: 5 
      }
    }),
    ctx.omit(['debugTools', 'mockServices'])
  ),

  test: flow(
    ctx.set('environment', 'test' as const),
    ctx.extend({ 
      testMode: true,
      silentLogging: true 
    }),
    ctx.merge({
      config: { 
        timeout: 1000,     // Fast timeouts for tests
        retries: 0         // No retries in tests
      }
    }),
    ctx.pick(['userId', 'sessionId', 'config', 'scope']) // Minimal test context
  )
});

// =============================================================================
// Example 3: Request Processing Pipeline
// =============================================================================

const processRequest = flow(
  ctx.set('requestId', crypto.randomUUID()),
  ctx.set('startTime', Date.now()),
  ctx.extend({ 
    tracing: true,
    correlationId: generateCorrelationId() 
  }),
  ctx.when(
    (context: UserSessionContext) => context.userId === 'admin',
    { adminAccess: true, auditLogging: true }
  ),
  ctx.when(
    (context: UserSessionContext) => context.environment === 'development',
    { requestLogging: true, performanceMetrics: true }
  ),
  ctx.omit(['sensitiveApiKeys', 'internalSecrets'])
);

// =============================================================================
// Example 4: Task Execution with Context Modifications
// =============================================================================

// Execute task with enhanced context
async function executeUserTask(userId: string, taskData: any) {
  return ctx.exec(
    flow(
      ctx.set('userId', userId),
      ctx.set('operationId', crypto.randomUUID()),
      ctx.update('permissions', (perms: string[]) => 
        userId === 'admin' ? ['admin'] : perms
      ),
      ctx.extend({ 
        taskMetadata: { 
          startTime: Date.now(),
          source: 'user-request' 
        } 
      })
    ),
    userTask,
    taskData
  );
}

// Execute function with scoped context
async function processWithTemporaryConfig() {
  return ctx.scope(
    flow(
      ctx.merge({
        config: { 
          timeout: 60000,    // Extended timeout for this operation
          retries: 10 
        }
      }),
      ctx.extend({ 
        operationType: 'batch-processing',
        batchId: generateBatchId() 
      })
    ),
    async () => {
      // All operations here use the modified context
      const result1 = await run(longRunningTask, data1);
      const result2 = await run(anotherTask, data2);
      return combineResults(result1, result2);
    }
  );
}

// =============================================================================
// Example 5: Complex Context Transformations
// =============================================================================

// Transform legacy context to modern structure
const modernizeContext = ctx.transform((legacy: LegacyUserContext) => ({
  scope: legacy.scope,
  user: {
    id: legacy.userId,
    name: legacy.userName,
    email: legacy.userEmail,
    role: legacy.userRole,
    preferences: parseUserPreferences(legacy.userSettings)
  },
  session: {
    id: legacy.sessionId,
    startTime: legacy.sessionStart,
    lastActivity: legacy.lastSeen,
    timeoutMs: legacy.sessionTimeout
  },
  services: {
    api: legacy.apiClient,
    database: legacy.dbConnection,
    cache: legacy.cacheService,
    queue: legacy.messageQueue
  },
  features: parseFeatureFlags(legacy.featureString),
  config: {
    environment: legacy.env,
    debug: legacy.debugMode,
    timeout: legacy.requestTimeout,
    retries: legacy.maxRetries
  }
}));

// Add computed properties
const addComputedProperties = ctx.transform((context: UserSessionContext) => ({
  ...context,
  computed: {
    isAdmin: context.permissions.includes('admin'),
    sessionAge: Date.now() - context.startTime,
    timeUntilExpiry: context.config.timeout - (Date.now() - context.startTime),
    hasWriteAccess: context.permissions.some(p => ['write', 'admin'].includes(p)),
    environmentLevel: getEnvironmentLevel(context.environment),
    fullDisplayName: `${context.userId} (${context.environment})`
  }
}));

// =============================================================================
// Example 6: Validation and Error Handling
// =============================================================================

const validateUserSession = createContextValidator<UserSessionContext>([
  'userId', 'sessionId', 'permissions', 'config'
]);

const safeUserContextPipeline = flow(
  buildUserSession,
  validateUserSession,
  ctx.when(
    (context: UserSessionContext) => context.permissions.length === 0,
    (context: UserSessionContext) => {
      console.warn(`User ${context.userId} has no permissions assigned`);
      return { ...context, permissions: ['read'] }; // Default permission
    }
  )
);

// =============================================================================
// Example 7: Reusable Context Patterns
// =============================================================================

// User authentication and authorization
const withUserAuth = (userId: string, role: string) => flow(
  ctx.set('userId', userId),
  ctx.set('userRole', role),
  ctx.update('permissions', () => getPermissionsForRole(role)),
  ctx.extend({ 
    authTime: Date.now(),
    authMethod: 'session-token' 
  })
);

// Request tracing and monitoring
const withRequestTracing = (operationName: string) => flow(
  ctx.set('operationName', operationName),
  ctx.set('traceId', generateTraceId()),
  ctx.set('spanId', generateSpanId()),
  ctx.extend({ 
    startTime: Date.now(),
    monitoring: true 
  })
);

// Development debugging
const withDebugInfo = flow(
  ctx.when(
    (context: UserSessionContext) => context.environment === 'development',
    ctx.extend({
      debugger: createDebugger(),
      profiler: createProfiler(),
      memoryTracker: createMemoryTracker()
    })
  )
);

// Combine patterns
const setupRequestContext = (userId: string, operationName: string) => flow(
  withUserAuth(userId, 'user'),
  withRequestTracing(operationName),
  withDebugInfo,
  environmentConfigs[process.env.NODE_ENV || 'development']
);

// =============================================================================
// Example 8: Advanced Composition and Reuse
// =============================================================================

// Create specialized pipelines for different use cases
const apiRequestPipeline = flow(
  ctx.extend({ source: 'api-request' }),
  ctx.set('requestType', 'api'),
  ctx.when(
    (context: UserSessionContext) => context.environment === 'production',
    ctx.extend({ rateLimiting: true, requestLogging: false })
  ),
  ctx.when(
    (context: UserSessionContext) => context.environment === 'development', 
    ctx.extend({ requestLogging: true, responseLogging: true })
  )
);

const backgroundJobPipeline = flow(
  ctx.extend({ source: 'background-job' }),
  ctx.set('requestType', 'background'),
  ctx.merge({
    config: {
      timeout: 300000,  // 5 minutes for background jobs
      retries: 3
    }
  }),
  ctx.extend({ 
    jobQueue: true,
    progressTracking: true 
  })
);

const adminOperationPipeline = flow(
  ctx.extend({ source: 'admin-operation' }),
  ctx.set('requestType', 'admin'),
  ctx.extend({ 
    adminAccess: true,
    auditLogging: true,
    elevatedPermissions: true 
  }),
  ctx.when(
    (context: UserSessionContext) => !context.permissions.includes('admin'),
    () => {
      throw new Error('Insufficient permissions for admin operation');
    }
  )
);

// Use the specialized pipelines
async function handleApiRequest(userId: string, requestData: any) {
  const contextPipeline = flow(
    setupRequestContext(userId, 'api-request'),
    apiRequestPipeline
  );
  
  return ctx.scope(contextPipeline, async () => {
    return await run(apiHandlerTask, requestData);
  });
}

async function processBackgroundJob(jobId: string, jobData: any) {
  const contextPipeline = flow(
    ctx.set('jobId', jobId),
    ctx.set('jobType', jobData.type),
    backgroundJobPipeline
  );
  
  return ctx.scope(contextPipeline, async () => {
    return await run(backgroundJobTask, jobData);
  });
}

// =============================================================================
// Example 9: Testing Patterns
// =============================================================================

// Create test-specific context configurations
const testContextBuilder = flow(
  environmentConfigs.test,
  ctx.extend({
    mockServices: {
      api: createMockApi(),
      database: createMockDatabase(),
      cache: createMockCache()
    },
    testData: {
      users: generateTestUsers(),
      sessions: generateTestSessions()
    }
  }),
  ctx.merge({
    config: {
      timeout: 100,    // Very fast timeouts for tests
      retries: 0       // No retries in tests
    }
  })
);

// Test utility for running tasks with clean context
async function runTaskInTestContext<V, R>(
  task: Task<UserSessionContext, V, R>,
  input: V,
  contextOverrides: Partial<UserSessionContext> = {}
) {
  const testContext = flow(
    testContextBuilder,
    ctx.extend(contextOverrides)
  );
  
  return ctx.scope(testContext, async () => {
    return await run(task, input);
  });
}

// =============================================================================
// Example 10: Performance Optimization Patterns
// =============================================================================

// Lazy context building for expensive operations
const createLazyContextBuilder = () => {
  let cachedExpensiveService: ExpensiveService | null = null;
  
  return ctx.transform((context: UserSessionContext) => {
    if (!cachedExpensiveService) {
      cachedExpensiveService = createExpensiveService(context.config);
    }
    
    return {
      ...context,
      expensiveService: cachedExpensiveService
    };
  });
};

const lazyContextBuilder = createLazyContextBuilder();

// Conditional expensive operations
const withConditionalServices = ctx.when(
  (context: UserSessionContext) => context.permissions.includes('admin'),
  ctx.transform((context: UserSessionContext) => ({
    ...context,
    adminServices: {
      auditLogger: createAuditLogger(),
      adminPanel: createAdminPanel(),
      systemMonitor: createSystemMonitor()
    }
  }))
);

// Memory-efficient context for batch operations
const batchContextOptimized = flow(
  ctx.pick(['userId', 'permissions', 'config', 'scope']), // Keep only essentials
  ctx.extend({ batchMode: true }),
  ctx.merge({
    config: {
      timeout: 1000,   // Short timeout for individual items
      retries: 1       // Minimal retries in batch
    }
  })
);
*/