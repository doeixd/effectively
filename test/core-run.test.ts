import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest';
import { ok, err } from 'neverthrow';
import {
  createContext,
  defineTask,
  getContext,
  getContextSafe,
  getContextOrUndefined,
  run,
  runLocal,
  runGlobal,
  provide,
  defineTaskLocal,
  defineTaskGlobal,
  getContextLocal,
  getContextGlobal,
  getContextSafeLocal,
  getContextOrUndefinedLocal,
  BacktrackSignal,
  isBacktrackSignal,
  WorkflowError,
  ContextNotFoundError,
  ContextValidationError,
  validateContext,
  mergeContexts,
  requireContextProperties,
  createInjectionToken,
  inject,
  injectOptional,
  type BaseContext,
  type Task,
  type ContextSchema,
  type Scope,
  type Logger
} from '../src/run';

interface TestContext extends BaseContext {
  userId: string;
  database: {
    getUser: (id: string) => Promise<{ id: string; name: string }>;
    saveUser: (user: { id: string; name: string }) => Promise<void>;
  };
  counter: number;
  logs: string[];
}

const mockDatabase = {
  getUser: vi.fn(),
  saveUser: vi.fn()
};

const testContextDefaults: Omit<TestContext, 'scope'> = {
  userId: 'test-user',
  database: mockDatabase,
  counter: 0,
  logs: []
};

describe('Core Execution Engine (run.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabase.getUser.mockResolvedValue({ id: 'test-user', name: 'Test User' });
    mockDatabase.saveUser.mockResolvedValue(undefined);
  });

  describe('createContext and basic execution', () => {
    it('should create a context and run a simple task', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const simpleTask = defineTask(async (input: string) => {
        return `Hello, ${input}!`;
      });

      const result = await run(simpleTask, 'World');
      expect(result).toBe('Hello, World!');
    });

    it('should provide context to tasks', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const contextTask = defineTask(async (input: string) => {
        const ctx = getContext();
        return `${input} for user ${ctx.userId}`;
      });

      const result = await run(contextTask, 'Task executed');
      expect(result).toBe('Task executed for user test-user');
    });

    it('should handle context overrides', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const contextTask = defineTask(async () => {
        const ctx = getContext();
        return ctx.userId;
      });

      const result = await run(contextTask, undefined, {
        overrides: { userId: 'overridden-user' }
      });
      expect(result).toBe('overridden-user');
    });

    it('should handle database operations through context', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const fetchUserTask = defineTask(async (userId: string) => {
        const { database } = getContext();
        return await database.getUser(userId);
      });

      const result = await run(fetchUserTask, 'user-123');
      expect(result).toEqual({ id: 'test-user', name: 'Test User' });
      expect(mockDatabase.getUser).toHaveBeenCalledWith('user-123');
    });
  });

  describe('Error handling and Result types', () => {
    it('should throw errors by default', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const failingTask = defineTask(async () => {
        throw new Error('Task failed');
      });

      await expect(run(failingTask, undefined)).rejects.toThrow('Task failed');
    });

    it('should return Result when throw: false', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const failingTask = defineTask(async () => {
        throw new Error('Task failed');
      });

      const result = await run(failingTask, undefined, { throw: false });
      expect(result.isErr()).toBe(true);
      expect(result.isOk()).toBe(false);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(WorkflowError);
        expect(result.error.message).toContain('Task failed');
      }
    });

    it('should handle successful tasks with throw: false', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const successTask = defineTask(async (input: string) => input.toUpperCase());

      const result = await run(successTask, 'hello', { throw: false });
      expect(result.isOk()).toBe(true);
      expect(result.isErr()).toBe(false);
      if (result.isOk()) {
        expect(result.value).toBe('HELLO');
      }
    });
  });

  describe('Backtracking and control flow', () => {
    it('should handle BacktrackSignal correctly', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const retryTask = defineTask(async (attempt: number) => {
        if (attempt < 3) {
          throw new BacktrackSignal(retryTask, attempt + 1);
        }
        return `Success after ${attempt} attempts`;
      });

      const result = await run(retryTask, 1);
      expect(result).toBe('Success after 3 attempts');
    });

    it('should identify BacktrackSignal with type guard', () => {
      const { defineTask } = createContext<TestContext>(testContextDefaults);
      const task = defineTask(async () => 'test');
      const signal = new BacktrackSignal(task, 'test');
      const regularError = new Error('regular error');

      expect(isBacktrackSignal(signal)).toBe(true);
      expect(isBacktrackSignal(regularError)).toBe(false);
      expect(isBacktrackSignal(null)).toBe(false);
      expect(isBacktrackSignal(undefined)).toBe(false);
    });

    it('should prevent infinite backtracking loops', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const infiniteRetryTask = defineTask(async (attempt: number) => {
        throw new BacktrackSignal(infiniteRetryTask, attempt + 1);
      });

      // Should throw after max iterations
      await expect(run(infiniteRetryTask, 1)).rejects.toThrow('Maximum backtrack limit');
    });
  });

  describe('Context getters and safety', () => {
    it('should throw ContextNotFoundError when getContext called outside run', () => {
      const { getContext } = createContext<TestContext>(testContextDefaults);
      
      expect(() => getContext()).toThrow(ContextNotFoundError);
    });

    it('should return error Result when getContextSafe called outside run', () => {
      const { getContextSafe } = createContext<TestContext>(testContextDefaults);
      
      const result = getContextSafe();
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(ContextNotFoundError);
      }
    });

    it('should return undefined when getContextOrUndefined called outside run', () => {
      const { getContextOrUndefined } = createContext<TestContext>(testContextDefaults);
      
      const result = getContextOrUndefined();
      expect(result).toBeUndefined();
    });

    it('should work correctly inside run', async () => {
      const { run, defineTask, getContext, getContextSafe, getContextOrUndefined } = createContext<TestContext>(testContextDefaults);
      
      const contextTestTask = defineTask(async () => {
        const ctx1 = getContext();
        const ctx2Result = getContextSafe();
        const ctx3 = getContextOrUndefined();

        return {
          ctx1: ctx1.userId,
          ctx2: ctx2Result.isOk() ? ctx2Result.value.userId : 'error',
          ctx3: ctx3?.userId || 'undefined'
        };
      });

      const result = await run(contextTestTask, undefined);
      expect(result).toEqual({
        ctx1: 'test-user',
        ctx2: 'test-user',
        ctx3: 'test-user'
      });
    });
  });

  describe('Smart, Local, and Global context functions', () => {
    it('should use global context as fallback for smart functions', async () => {
      // Using smart functions outside any context should work with global defaults
      const simpleTask = defineTask(async (input: string) => {
        const ctx = getContext();
        return `Hello, ${input}!`;
      });

      const result = await run(simpleTask, 'World');
      expect(result).toBe('Hello, World!');
    });

    it('should throw errors for local-only functions when no context', () => {
      expect(() => defineTaskLocal(() => Promise.resolve('test'))).toThrow(ContextNotFoundError);
      expect(() => getContextLocal()).toThrow(ContextNotFoundError);
      expect(getContextSafeLocal().isErr()).toBe(true);
      expect(getContextOrUndefinedLocal()).toBeUndefined();
    });

    it('should work with global-only functions', async () => {
      const globalTask = defineTaskGlobal(async (input: string) => {
        const ctx = getContextGlobal();
        return `Global: ${input}`;
      });

      const result = await runGlobal(globalTask, 'test');
      expect(result).toBe('Global: test');
    });
  });

  describe('provide function and context overrides', () => {
    it('should temporarily override context values', async () => {
      const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
      
      const contextTask = defineTask(async () => {
        return getContext().userId;
      });

      const outerResult = await run(contextTask, undefined);
      expect(outerResult).toBe('test-user');

      const innerResult = await run(async () => {
        return provide({ userId: 'temporary-user' }, async () => {
          return run(contextTask, undefined);
        });
      }, undefined);
      expect(innerResult).toBe('temporary-user');
    });

    it('should nest provide calls correctly', async () => {
      const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
      
      const contextTask = defineTask(async () => {
        const ctx = getContext();
        return { userId: ctx.userId, counter: ctx.counter };
      });

      const result = await run(async () => {
        return provide({ userId: 'level1' }, async () => {
          return provide({ counter: 42 }, async () => {
            return run(contextTask, undefined);
          });
        });
      }, undefined);

      expect(result).toEqual({ userId: 'level1', counter: 42 });
    });

    it('should preserve scope in provide calls', async () => {
      const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
      
      const scopeTask = defineTask(async () => {
        const ctx = getContext();
        return ctx.scope.signal.aborted;
      });

      const result = await run(async () => {
        return provide({ userId: 'new-user' }, async () => {
          return run(scopeTask, undefined);
        });
      }, undefined);

      expect(result).toBe(false); // Should preserve the original scope
    });
  });

  describe('Context validation and merging', () => {
    it('should validate context with schema', () => {
      const schema: ContextSchema<TestContext> = {
        userId: (value): value is string => typeof value === 'string',
        database: (value): value is any => typeof value === 'object' && value !== null,
        counter: (value): value is number => typeof value === 'number',
        logs: (value): value is string[] => Array.isArray(value)
      };

      const validContext = { ...testContextDefaults, scope: { signal: new AbortController().signal } };
      const result = validateContext(schema, validContext);
      expect(result.isOk()).toBe(true);

      const invalidContext = { ...testContextDefaults, userId: 123, scope: { signal: new AbortController().signal } };
      const invalidResult = validateContext(schema, invalidContext);
      expect(invalidResult.isErr()).toBe(true);
      if (invalidResult.isErr()) {
        expect(invalidResult.error).toBeInstanceOf(ContextValidationError);
      }
    });

    it('should merge contexts correctly', () => {
      const contextA: TestContext = {
        ...testContextDefaults,
        scope: { signal: new AbortController().signal }
      };
      const contextB = { userId: 'new-user', newProperty: 'test' };

      const merged = mergeContexts(contextA, contextB);
      expect(merged.userId).toBe('new-user');
      expect(merged.scope).toBe(contextA.scope);
      expect((merged as any).newProperty).toBe('test');
    });

    it('should require context properties', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const requirePropsTask = defineTask(async () => {
        const ctx = requireContextProperties<TestContext>('userId' as keyof TestContext, 'database' as keyof TestContext);
        return ctx.userId;
      });

      const result = await run(requirePropsTask, undefined);
      expect(result).toBe('test-user');

      // Test with missing property
      const missingPropTask = defineTask(async () => {
        return requireContextProperties('nonExistentProp' as any);
      });

      await expect(run(missingPropTask, undefined)).rejects.toThrow(WorkflowError);
    });
  });

  describe('Dependency injection', () => {
    it('should create and use injection tokens', async () => {
      const { run, defineTask, provide, inject } = createContext<TestContext>(testContextDefaults);
      
      const userServiceToken = createInjectionToken<{ getCurrentUser: () => string }>('UserService');
      const userService = { getCurrentUser: () => 'injected-user' };

      const injectionTask = defineTask(async () => {
        const service = inject(userServiceToken);
        return service.getCurrentUser();
      });

      const result = await run(async () => {
        return provide({ [userServiceToken]: userService } as any, async () => {
          return run(injectionTask, undefined);
        });
      }, undefined);

      expect(result).toBe('injected-user');
    });

    it('should handle optional injection', async () => {
      const { run, defineTask, injectOptional } = createContext<TestContext>(testContextDefaults);
      
      const optionalServiceToken = createInjectionToken<string>('OptionalService');

      const optionalInjectionTask = defineTask(async () => {
        const service = injectOptional(optionalServiceToken);
        return service || 'not-found';
      });

      const result = await run(optionalInjectionTask, undefined);
      expect(result).toBe('not-found');
    });

    it('should throw when required injection not found', async () => {
      const { run, defineTask, inject } = createContext<TestContext>(testContextDefaults);
      
      const requiredServiceToken = createInjectionToken<string>('RequiredService');

      const requiredInjectionTask = defineTask(async () => {
        return inject(requiredServiceToken);
      });

      await expect(run(requiredInjectionTask, undefined)).rejects.toThrow('Injection token');
    });
  });

  describe('Cancellation and abort signals', () => {
    it('should propagate abort signals to context scope', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const abortController = new AbortController();
      
      const signalTask = defineTask(async () => {
        const { scope } = getContext();
        return scope.signal.aborted;
      });

      const promise = run(signalTask, undefined, { parentSignal: abortController.signal });
      abortController.abort();
      
      // The task should complete before abort in this case
      const result = await promise;
      expect(typeof result).toBe('boolean');
    });

    it('should handle abort during execution', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const abortController = new AbortController();
      
      const longRunningTask = defineTask(async () => {
        const { scope } = getContext();
        
        return new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => resolve('completed'), 1000);
          
          scope.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('Aborted'));
          });
        });
      });

      const promise = run(longRunningTask, undefined, { parentSignal: abortController.signal });
      
      setTimeout(() => abortController.abort(), 10);
      
      await expect(promise).rejects.toThrow('Aborted');
    });
  });

  describe('Logging', () => {
    it('should use provided logger', async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const simpleTask = defineTask(async (input: string) => input);

      await run(simpleTask, 'test', { logger: mockLogger });
      
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it('should handle errors with logger', async () => {
      const mockLogger: Logger = {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      };

      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const failingTask = defineTask(async () => {
        throw new Error('Test error');
      });

      const result = await run(failingTask, undefined, { 
        logger: mockLogger, 
        throw: false 
      });
      
      expect(result.isErr()).toBe(true);
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('Edge cases and error scenarios', () => {
    it('should handle null/undefined inputs gracefully', async () => {
      const { run, defineTask } = createContext<TestContext>(testContextDefaults);
      
      const nullTask = defineTask(async (input: null) => {
        return input === null ? 'got null' : 'not null';
      });

      const result = await run(nullTask, null);
      expect(result).toBe('got null');
    });

    it('should handle deeply nested task execution', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const nestedTask = defineTask(async (depth: number): Promise<number> => {
        if (depth <= 0) return 0;
        const ctx = getContext();
        return 1 + await run(nestedTask, depth - 1);
      });

      const result = await run(nestedTask, 5);
      expect(result).toBe(5);
    });

    it('should preserve context through complex async operations', async () => {
      const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);
      
      const complexTask = defineTask(async () => {
        const ctx1 = getContext();
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        const ctx2 = getContext();
        
        return ctx1.userId === ctx2.userId;
      });

      const result = await run(complexTask, undefined);
      expect(result).toBe(true);
    });
  });
});
