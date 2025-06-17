/**
 * ContextTools Utils - Complete Utilities for Working with ContextTools
 * 
 * This module provides specialized utilities that operate on ContextTools instances
 * returned by createContext(). These utilities extend and enhance the capabilities
 * of ContextTools with additional functionality for:
 * - Creating context-bound primitives
 * - Separating concerns (transformers vs executors)
 * - Development and debugging
 * - Validation and type safety
 * - Performance optimization
 */

import type {
  BaseContext,
  ContextTools,
  Task,
  RunOptions,
  ProvideImplOptions
} from './run';
import type { ContextConfig } from './context-utils';
import {
  createBoundExtend,
  createBoundPick,
  createBoundOmit,
  createBoundSet,
  createBoundUpdate,
  createBoundWhen,
  createBoundTransform,
  createBoundMerge,
  createBoundScope,
  createBoundExec
} from './context-utils';

// =============================================================================
// Type-Safe Wrapper Functions
// =============================================================================

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

// =============================================================================
// Core ContextTools Utilities
// =============================================================================

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
// Specialized ContextTools Utilities
// =============================================================================

/**
 * Extracts just the context transformation functions from ContextTools,
 * excluding execution functions like run and provide. Useful when you only 
 * need context transformation capabilities without execution.
 * 
 * @template C The BaseContext type that the ContextTools operates on
 * @param contextSystem The ContextTools instance from createContext()
 * @returns Only the context transformation utilities
 * 
 * @example
 * ```typescript
 * const contextSystem = createContext<AppContext>({...});
 * const transformers = createContextTransformers(contextSystem);
 * 
 * // Only context transformation functions, no run/provide
 * const pipeline = flow(
 *   transformers.set('userId', '123'),
 *   transformers.extend({ debug: true }),
 *   transformers.omit(['sensitiveData'])
 * );
 * 
 * // Transform context without executing anything
 * const modifiedContext = pipeline(baseContext);
 * 
 * // Later, execute with a different system if needed
 * await anotherContextSystem.run(myTask, data, { overrides: modifiedContext });
 * ```
 */
export function createContextTransformers<C extends BaseContext>(
  contextSystem: ContextTools<C>
): {
  /** Extends context with additional properties */
  extend: ReturnType<typeof createBoundExtend<C>>;
  /** Selects only specified properties from context */
  pick: ReturnType<typeof createBoundPick<C>>;
  /** Removes specified properties from context */
  omit: ReturnType<typeof createBoundOmit<C>>;
  /** Sets a single property */
  set: ReturnType<typeof createBoundSet<C>>;
  /** Updates an existing property using a function */
  update: ReturnType<typeof createBoundUpdate<C>>;
  /** Conditionally applies modifications */
  when: ReturnType<typeof createBoundWhen<C>>;
  /** Applies arbitrary transformation */
  transform: ReturnType<typeof createBoundTransform<C>>;
  /** Deep merges contexts */
  merge: ReturnType<typeof createBoundMerge<C>>;
  /** Gets the current context */
  getContext: () => C;
} {
  const config = createContextConfig(contextSystem);

  return {
    extend: createBoundExtend(config),
    pick: createBoundPick(config),
    omit: createBoundOmit(config),
    set: createBoundSet(config),
    update: createBoundUpdate(config),
    when: createBoundWhen(config),
    transform: createBoundTransform(config),
    merge: createBoundMerge(config),
    getContext: contextSystem.getContext
  };
}

/**
 * Extracts just the execution functions from ContextTools.
 * Useful when you want to separate context transformation from execution,
 * or when you have pre-built transformers and just need execution capabilities.
 * 
 * @template C The BaseContext type that the ContextTools operates on
 * @param contextSystem The ContextTools instance from createContext()
 * @returns Only the execution utilities
 * 
 * @example
 * ```typescript
 * const contextSystem = createContext<AppContext>({...});
 * const executor = createContextExecutor(contextSystem);
 * 
 * // Pre-built transformer from somewhere else
 * const myTransformer = flow(
 *   set('userId', '123'),
 *   extend({ debug: true })
 * );
 * 
 * // Only execution functions
 * await executor.scope(myTransformer, async () => {
 *   return await executor.run(myTask, data);
 * });
 * 
 * // Direct provide usage
 * await executor.provide({ debug: true }, async () => {
 *   await executor.run(anotherTask, moreData);
 * });
 * ```
 */
export function createContextExecutor<C extends BaseContext>(
  contextSystem: ContextTools<C>
): {
  /** Executes a function with temporarily modified context */
  scope: ReturnType<typeof createBoundScope<C>>;
  /** Executes a task with modified context */
  exec: ReturnType<typeof createBoundExec<C>>;
  /** Creates nested scope with overrides */
  provide: ContextTools<C>['provide'];
  /** Runs a task in this context */
  run: ContextTools<C>['run'];
  /** Gets the current context */
  getContext: () => C;
} {
  const config = createContextConfig(contextSystem);

  return {
    scope: createBoundScope(config),
    exec: createBoundExec(config),
    provide: contextSystem.provide,
    run: contextSystem.run,
    getContext: contextSystem.getContext
  };
}

// =============================================================================
// Development and Debugging Utilities
// =============================================================================

/**
 * Creates a context validator that works specifically with a ContextTools instance.
 * Validates that the current context has all required properties with proper typing.
 * 
 * @template C The BaseContext type that the ContextTools operates on
 * @param contextSystem The ContextTools instance from createContext()
 * @param requiredKeys Array of property names that must exist in the context
 * @returns Validation utilities for the context
 * 
 * @example
 * ```typescript
 * const contextSystem = createContext<UserContext>({...});
 * const validator = createContextValidator(contextSystem, ['userId', 'permissions']);
 * 
 * // Throws if current context is missing required properties
 * try {
 *   validator.validateCurrent();
 *   console.log('Context is valid');
 * } catch (error) {
 *   console.error('Invalid context:', error.message);
 * }
 * 
 * // Returns boolean instead of throwing
 * if (validator.isValid()) {
 *   // Safe to proceed with operations that require these properties
 *   await contextSystem.run(userTask, data);
 * }
 * 
 * // Validate arbitrary context object
 * const isValidContext = validator.validate(someContextObject);
 * 
 * // Get list of missing properties for debugging
 * const missing = validator.getMissingProperties();
 * if (missing.length > 0) {
 *   console.warn('Missing properties:', missing);
 * }
 * ```
 */
export function createContextValidator<C extends BaseContext>(
  contextSystem: ContextTools<C>,
  requiredKeys: (keyof C)[]
): {
  /** Validates the current context, throwing if invalid */
  validateCurrent(): C;
  /** Checks if the current context is valid without throwing */
  isValid(): boolean;
  /** Validates an arbitrary context object */
  validate(context: C): C;
  /** Lists missing properties in the current context */
  getMissingProperties(): string[];
  /** Gets detailed validation info including property types */
  getValidationInfo(): {
    valid: boolean;
    missing: string[];
    present: string[];
    requiredCount: number;
    presentCount: number;
  };
} {
  const validateContext = (context: C): C => {
    const missing: string[] = [];

    for (const key of requiredKeys) {
      if (!(key in context) || context[key] === undefined) {
        missing.push(String(key));
      }
    }

    if (missing.length > 0) {
      throw new Error(
        `Context validation failed. Missing required properties: ${missing.join(', ')}`
      );
    }

    return context;
  };

  const getMissingInContext = (context: C): string[] => {
    const missing: string[] = [];

    for (const key of requiredKeys) {
      if (!(key in context) || context[key] === undefined) {
        missing.push(String(key));
      }
    }

    return missing;
  };

  return {
    validateCurrent(): C {
      const context = contextSystem.getContext();
      return validateContext(context);
    },

    isValid(): boolean {
      try {
        this.validateCurrent();
        return true;
      } catch {
        return false;
      }
    },

    validate(context: C): C {
      return validateContext(context);
    },

    getMissingProperties(): string[] {
      const context = contextSystem.getContext();
      return getMissingInContext(context);
    },

    getValidationInfo() {
      const context = contextSystem.getContext();
      const missing = getMissingInContext(context);
      const present = requiredKeys.filter(key =>
        key in context && context[key] !== undefined
      ).map(String);

      return {
        valid: missing.length === 0,
        missing,
        present,
        requiredCount: requiredKeys.length,
        presentCount: present.length
      };
    }
  };
}

/**
 * Creates a context debugger that provides introspection capabilities
 * for a ContextTools instance. Useful for development and troubleshooting
 * context-related issues.
 * 
 * @template C The BaseContext type that the ContextTools operates on
 * @param contextSystem The ContextTools instance from createContext()
 * @param options Configuration for the debugger behavior
 * @returns Debugging utilities for the context
 * 
 * @example
 * ```typescript
 * const contextSystem = createContext<AppContext>({...});
 * const debugger = createContextDebugger(contextSystem, {
 *   logger: (msg, data) => console.log(`[DEBUG] ${msg}`, data),
 *   includeScope: false // Don't include scope in debug output
 * });
 * 
 * // Log current context state
 * debugger.logContext('Before user login');
 * 
 * // Get context diff from defaults
 * const diff = debugger.getDiff(defaultContext);
 * console.log('Changes from default:', diff);
 * 
 * // Trace context changes during execution
 * await debugger.traceExecution(async () => {
 *   // Context changes will be automatically logged
 *   await contextSystem.provide({ debug: true }, async () => {
 *     await contextSystem.run(someTask, data);
 *   });
 * });
 * 
 * // Get detailed context information
 * const info = debugger.getContextInfo();
 * info.forEach(({ key, type, value }) => {
 *   console.log(`${key}: ${type} = ${JSON.stringify(value)}`);
 * });
 * ```
 */
export function createContextDebugger<C extends BaseContext>(
  contextSystem: ContextTools<C>,
  options: {
    /** Custom logger function */
    logger?: (message: string, data?: any) => void;
    /** Include scope in debug output */
    includeScope?: boolean;
    /** Track performance metrics */
    trackPerformance?: boolean;
  } = {}
): {
  /** Logs the current context state */
  logContext(label?: string): void;
  /** Gets a snapshot of the current context */
  getSnapshot(): C;
  /** Compares current context with a reference */
  getDiff(reference: C): { added: string[]; removed: string[]; changed: string[] };
  /** Traces execution and logs context changes */
  traceExecution<R>(fn: () => Promise<R>): Promise<R>;
  /** Gets context properties and their types */
  getContextInfo(): { key: string; type: string; value: any; size?: string }[];
  /** Gets performance metrics if tracking is enabled */
  getPerformanceMetrics(): {
    totalSnapshots: number;
    totalComparisons: number;
    averageSnapshotTime: number;
    lastOperationTime: number;
  };
  /** Validates context against a schema */
  validateStructure(expectedStructure: Record<string, string>): {
    valid: boolean;
    missingKeys: string[];
    wrongTypes: { key: string; expected: string; actual: string }[];
  };
} {
  const logger = options.logger || console.log;
  const includeScope = options.includeScope ?? false;
  const trackPerformance = options.trackPerformance ?? false;

  // Performance tracking
  let performanceMetrics = {
    totalSnapshots: 0,
    totalComparisons: 0,
    snapshotTimes: [] as number[],
    lastOperationTime: 0
  };

  const sanitizeContext = (context: C) => {
    const sanitized = { ...context };
    if (!includeScope) {
      delete (sanitized as any).scope;
    }
    return sanitized;
  };

  const getObjectSize = (obj: any): string => {
    try {
      const jsonString = JSON.stringify(obj);
      const bytes = new Blob([jsonString]).size;
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    } catch {
      return 'unknown';
    }
  };

  return {
    logContext(label = 'Current Context'): void {
      const context = contextSystem.getContext();
      const sanitized = sanitizeContext(context);
      logger(`[Context Debug] ${label}:`, sanitized);
    },

    getSnapshot(): C {
      const start = trackPerformance ? performance.now() : 0;
      const snapshot = { ...contextSystem.getContext() };

      if (trackPerformance) {
        const time = performance.now() - start;
        performanceMetrics.totalSnapshots++;
        performanceMetrics.snapshotTimes.push(time);
        performanceMetrics.lastOperationTime = time;
      }

      return snapshot;
    },

    getDiff(reference: C): { added: string[]; removed: string[]; changed: string[] } {
      const start = trackPerformance ? performance.now() : 0;
      const current = contextSystem.getContext();
      const added: string[] = [];
      const removed: string[] = [];
      const changed: string[] = [];

      // Find added and changed
      for (const key in current) {
        if (!(key in reference)) {
          added.push(key);
        } else if (current[key] !== reference[key]) {
          changed.push(key);
        }
      }

      // Find removed
      for (const key in reference) {
        if (!(key in current)) {
          removed.push(key);
        }
      }

      if (trackPerformance) {
        const time = performance.now() - start;
        performanceMetrics.totalComparisons++;
        performanceMetrics.lastOperationTime = time;
      }

      return { added, removed, changed };
    },

    async traceExecution<R>(fn: () => Promise<R>): Promise<R> {
      const beforeSnapshot = this.getSnapshot();
      logger('[Context Debug] Starting traced execution', sanitizeContext(beforeSnapshot));

      try {
        const result = await fn();
        const afterSnapshot = this.getSnapshot();
        const diff = this.getDiff(beforeSnapshot);

        logger('[Context Debug] Execution completed', {
          diff,
          finalContext: sanitizeContext(afterSnapshot)
        });

        return result;
      } catch (error) {
        const errorSnapshot = this.getSnapshot();
        const diff = this.getDiff(beforeSnapshot);

        logger('[Context Debug] Execution failed', {
          error: error instanceof Error ? error.message : String(error),
          diff,
          contextAtFailure: sanitizeContext(errorSnapshot)
        });

        throw error;
      }
    },

    getContextInfo(): { key: string; type: string; value: any; size?: string }[] {
      const context = contextSystem.getContext();
      return Object.entries(context).map(([key, value]) => ({
        key,
        type: typeof value,
        value: includeScope || key !== 'scope' ? value : '[Hidden]',
        size: trackPerformance ? getObjectSize(value) : undefined
      }));
    },

    getPerformanceMetrics() {
      const avgSnapshotTime = performanceMetrics.snapshotTimes.length > 0
        ? performanceMetrics.snapshotTimes.reduce((a, b) => a + b, 0) / performanceMetrics.snapshotTimes.length
        : 0;

      return {
        totalSnapshots: performanceMetrics.totalSnapshots,
        totalComparisons: performanceMetrics.totalComparisons,
        averageSnapshotTime: Number(avgSnapshotTime.toFixed(3)),
        lastOperationTime: Number(performanceMetrics.lastOperationTime.toFixed(3))
      };
    },

    validateStructure(expectedStructure: Record<string, string>) {
      const context = contextSystem.getContext();
      const missingKeys: string[] = [];
      const wrongTypes: { key: string; expected: string; actual: string }[] = [];

      for (const [key, expectedType] of Object.entries(expectedStructure)) {
        if (!(key in context)) {
          missingKeys.push(key);
        } else {
          const actualType = typeof context[key as keyof C];
          if (actualType !== expectedType) {
            wrongTypes.push({ key, expected: expectedType, actual: actualType });
          }
        }
      }

      return {
        valid: missingKeys.length === 0 && wrongTypes.length === 0,
        missingKeys,
        wrongTypes
      };
    }
  };
}

// =============================================================================
// Testing and Mocking Utilities
// =============================================================================

/**
 * Creates testing utilities specifically for ContextTools instances.
 * Provides mocking, isolation, and test-specific context operations.
 * 
 * @template C The BaseContext type that the ContextTools operates on
 * @param contextSystem The ContextTools instance from createContext()
 * @returns Testing utilities for the context system
 * 
 * @example
 * ```typescript
 * const contextSystem = createContext<AppContext>({...});
 * const testUtils = createContextTestUtils(contextSystem);
 * 
 * // Create isolated test context
 * const isolatedContext = testUtils.createIsolatedContext({
 *   api: mockApi,
 *   db: mockDb
 * });
 * 
 * // Run task in isolated environment
 * const result = await testUtils.runInIsolation(
 *   myTask,
 *   testData,
 *   isolatedContext
 * );
 * 
 * // Mock specific context properties
 * const mockContext = testUtils.createMockContext({
 *   'api.fetchUser': () => Promise.resolve(mockUser),
 *   'db.save': jest.fn()
 * });
 * 
 * // Assert context state after execution
 * await testUtils.runAndAssertContext(
 *   myTask,
 *   testData,
 *   (contextBefore, contextAfter) => {
 *     expect(contextAfter.userId).toBe('123');
 *   }
 * );
 * ```
 */
export function createContextTestUtils<C extends BaseContext>(
  contextSystem: ContextTools<C>
): {
  /** Creates an isolated context for testing */
  createIsolatedContext(overrides: Parameters<ContextTools<C>['provide']>[0]): Parameters<ContextTools<C>['provide']>[0];

  /** Runs a task in complete isolation with test context */
  runInIsolation<V, R>(
    task: Task<C, V, R>,
    value: V,
    testContext: Parameters<ContextTools<C>['provide']>[0],
    options?: { timeout?: number; expectError?: boolean }
  ): Promise<R>;

  /** Creates a mock context with spy functions */
  createMockContext(mocks: Record<string, any>): Parameters<ContextTools<C>['provide']>[0];

  /** Runs task and provides before/after context for assertions */
  runAndAssertContext<V, R>(
    task: Task<C, V, R>,
    value: V,
    assertion: (contextBefore: C, contextAfter: C) => void,
    overrides?: Parameters<ContextTools<C>['provide']>[0]
  ): Promise<R>;

  /** Creates a context snapshot for comparison */
  createSnapshot(): C;

  /** Validates context matches expected test state */
  validateTestContext(expected: Partial<C>): {
    valid: boolean;
    mismatches: Array<{ key: string; expected: any; actual: any }>;
  };
} {
  return {
    createIsolatedContext(overrides: Parameters<ContextTools<C>['provide']>[0]) {
      // Create a clean test context with only the specified overrides
      return { ...overrides };
    },

    async runInIsolation<V, R>(
      task: Task<C, V, R>,
      value: V,
      testContext: Parameters<ContextTools<C>['provide']>[0],
      options: { timeout?: number; expectError?: boolean } = {}
    ): Promise<R> {
      const { timeout = 5000, expectError = false } = options;

      const execution = contextSystem.run(task, value, {
        overrides: testContext,
        throw: !expectError
      } as any);

      if (timeout > 0) {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Test timeout after ${timeout}ms`)), timeout)
        );

        return Promise.race([execution, timeoutPromise]) as Promise<R>;
      }

      return execution;
    },

    createMockContext(mocks: Record<string, any>) {
      // Create spy functions and mock objects
      const mockContext: Record<string, any> = {};

      for (const [key, value] of Object.entries(mocks)) {
        if (key.includes('.')) {
          // Handle nested properties like 'api.fetchUser'
          const [parent, child] = key.split('.');
          if (!mockContext[parent]) {
            mockContext[parent] = {};
          }
          mockContext[parent][child] = value;
        } else {
          mockContext[key] = value;
        }
      }

      return mockContext as Parameters<ContextTools<C>['provide']>[0];
    },

    async runAndAssertContext<V, R>(
      task: Task<C, V, R>,
      value: V,
      assertion: (contextBefore: C, contextAfter: C) => void,
      overrides?: Parameters<ContextTools<C>['provide']>[0]
    ): Promise<R> {
      let contextBefore: C;
      let contextAfter: C;

      const result = await contextSystem.provide(overrides || {}, async () => {
        contextBefore = { ...contextSystem.getContext() };
        const taskResult = await contextSystem.run(task, value);
        contextAfter = { ...contextSystem.getContext() };
        return taskResult;
      });

      assertion(contextBefore!, contextAfter!);
      return result;
    },

    createSnapshot(): C {
      return { ...contextSystem.getContext() };
    },

    validateTestContext(expected: Partial<C>) {
      const actual = contextSystem.getContext();
      const mismatches: Array<{ key: string; expected: any; actual: any }> = [];

      for (const [key, expectedValue] of Object.entries(expected)) {
        const actualValue = (actual as any)[key];

        if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
          mismatches.push({
            key,
            expected: expectedValue,
            actual: actualValue
          });
        }
      }

      return {
        valid: mismatches.length === 0,
        mismatches
      };
    }
  };
}

// =============================================================================
// Export Summary
// =============================================================================

/**
 * Re-export commonly used utilities for convenience
 */
export {
  createContextPrimitives as createPrimitives,
  createContextTransformers as createTransformers,
  createContextExecutor as createExecutor,
  createContextValidator as createValidator,
  createContextDebugger as createDebugger,
  createContextTestUtils as createTestUtils
};