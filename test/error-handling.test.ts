import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ok, err } from 'neverthrow';
import {
  createErrorType,
  createErrorHandler,
  withErrorBoundary,
  tryCatch,
  type ErrorTypeOptions,
  type ErrorHandler
} from '../src/errors';
import {
  createContext,
  defineTask,
  getContext,
  run,
  BacktrackSignal,
  isBacktrackSignal,
  type BaseContext,
  type Task
} from '../src/run';

interface TestContext extends BaseContext {
  userId: string;
  logger: {
    error: (msg: string, error?: any) => void;
    warn: (msg: string, ...args: any[]) => void;
    info: (msg: string, ...args: any[]) => void;
  };
}

const mockLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn()
};

const testContextDefaults: Omit<TestContext, 'scope'> = {
  userId: 'test-user',
  logger: mockLogger
};

describe('Error Handling (errors.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createErrorType', () => {
    it('should create a basic custom error type', () => {
      const CustomError = createErrorType<[string]>({ name: 'CustomError' });
      const error = new CustomError('Test message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CustomError);
      expect(error.name).toBe('CustomError');
      expect(error.message).toBe('Test message');
    });

    it('should create hierarchical error types', () => {
      const BaseError = createErrorType<[string]>({ name: 'BaseError' });
      const SpecificError = createErrorType<[string]>({ 
        name: 'SpecificError', 
        parent: BaseError 
      });

      const error = new SpecificError('Specific error message');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(BaseError);
      expect(error).toBeInstanceOf(SpecificError);
      expect(error.name).toBe('SpecificError');
      expect(error.message).toBe('Specific error message');
    });

    it('should create multi-level inheritance hierarchies', () => {
      const DatabaseError = createErrorType<[string]>({ name: 'DatabaseError' });
      const ConnectionError = createErrorType<[string]>({ 
        name: 'ConnectionError', 
        parent: DatabaseError 
      });
      const TimeoutError = createErrorType<[string]>({ 
        name: 'TimeoutError', 
        parent: ConnectionError 
      });

      const error = new TimeoutError('Connection timed out');

      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(DatabaseError);
      expect(error).toBeInstanceOf(ConnectionError);
      expect(error).toBeInstanceOf(TimeoutError);
      expect(error.name).toBe('TimeoutError');
    });

    it('should handle custom constructor parameters', () => {
      const CustomError = createErrorType<[string, number]>({ name: 'CustomError' });
      const error = new CustomError('Error with code', 404);

      expect(error).toBeInstanceOf(CustomError);
      expect(error.message).toBe('Error with code');
      // Additional properties should be preserved from Error constructor behavior
    });

    it('should maintain proper stack traces', () => {
      const CustomError = createErrorType<[string]>({ name: 'CustomError' });
      const error = new CustomError('Stack trace test');

      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('CustomError: Stack trace test');
    });

    it('should set constructor name properly', () => {
      const DatabaseError = createErrorType<[string]>({ name: 'DatabaseError' });
      expect(DatabaseError.name).toBe('DatabaseError');
    });

    it('should handle errors with no message', () => {
      const EmptyError = createErrorType<[]>({ name: 'EmptyError' });
      const error = new EmptyError();

      expect(error).toBeInstanceOf(EmptyError);
      expect(error.name).toBe('EmptyError');
    });
  });

  describe('createErrorHandler', () => {
    it('should create a typed error handler tuple', () => {
      const CustomError = createErrorType<[string]>({ name: 'CustomError' });
      
      const handler = createErrorHandler(
        CustomError,
        (error: InstanceType<typeof CustomError>, context: TestContext) => {
          return `Handled: ${error.message}`;
        }
      );

      expect(handler).toHaveLength(2);
      expect(handler[0]).toBe(CustomError);
      expect(typeof handler[1]).toBe('function');
    });

    it('should provide correct error typing in handler', () => {
      const NetworkError = createErrorType<[string, number]>({ name: 'NetworkError' });
      
      const handler = createErrorHandler(
        NetworkError,
        (error, context: TestContext) => {
          // TypeScript should infer that error is of type NetworkError
          expect(error).toBeInstanceOf(NetworkError);
          expect(error.name).toBe('NetworkError');
          return 'network-error-handled';
        }
      );

      const [ErrorClass, handlerFn] = handler;
      const testError = new ErrorClass('Network failed', 500);
      const result = handlerFn(testError, testContextDefaults as TestContext);
      
      expect(result).toBe('network-error-handled');
    });

    it('should work with async handlers', async () => {
      const AsyncError = createErrorType<[string]>({ name: 'AsyncError' });
      
      const handler = createErrorHandler(
        AsyncError,
        async (error, context: TestContext) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return `async-handled: ${error.message}`;
        }
      );

      const [ErrorClass, handlerFn] = handler;
      const testError = new ErrorClass('Async error');
      const result = await handlerFn(testError, testContextDefaults as TestContext);
      
      expect(result).toBe('async-handled: Async error');
    });
  });

  describe('withErrorBoundary', () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    it('should catch and handle specific errors', async () => {
      const NetworkError = createErrorType<[string]>({ name: 'NetworkError' });
      
      const failingTask = defineTask(async () => {
        throw new NetworkError('Connection failed');
      });

      const protectedTask = withErrorBoundary(failingTask, [
        createErrorHandler(NetworkError, (error, context) => {
          context.logger.error('Network error caught', error);
          return 'fallback-result';
        })
      ]);

      const result = await run(protectedTask, undefined);
      expect(result).toBe('fallback-result');
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Network error caught',
        expect.any(NetworkError)
      );
    });

    it('should handle hierarchical errors correctly', async () => {
      const DatabaseError = createErrorType<[string]>({ name: 'DatabaseError' });
      const ConnectionError = createErrorType<[string]>({ 
        name: 'ConnectionError', 
        parent: DatabaseError 
      });

      const failingTask = defineTask(async () => {
        throw new ConnectionError('Could not connect to database');
      });

      const protectedTask = withErrorBoundary(failingTask, [
        createErrorHandler(DatabaseError, (error, context) => {
          return `Database error handled: ${error.message}`;
        })
      ]);

      const result = await run(protectedTask, undefined);
      expect(result).toBe('Database error handled: Could not connect to database');
    });

    it('should match handlers in order', async () => {
      const BaseError = createErrorType<[string]>({ name: 'BaseError' });
      const SpecificError = createErrorType<[string]>({ 
        name: 'SpecificError', 
        parent: BaseError 
      });

      const failingTask = defineTask(async () => {
        throw new SpecificError('Specific error');
      });

      // More specific handler first
      const protectedTask1 = withErrorBoundary(failingTask, [
        createErrorHandler(SpecificError, () => 'specific-handler'),
        createErrorHandler(BaseError, () => 'base-handler')
      ]);

      const result1 = await run(protectedTask1, undefined);
      expect(result1).toBe('specific-handler');

      // General handler first (should still catch specific errors)
      const protectedTask2 = withErrorBoundary(failingTask, [
        createErrorHandler(BaseError, () => 'base-handler'),
        createErrorHandler(SpecificError, () => 'specific-handler')
      ]);

      const result2 = await run(protectedTask2, undefined);
      expect(result2).toBe('base-handler');
    });

    it('should not catch BacktrackSignal errors', async () => {
      // Create a self-referencing task that can backtrack to itself
      let protectedTask: Task<TestContext, number, number>;
      
      const backtrackingTask = defineTask(async function backtrackingImplementation(attempt: number) {
        if (attempt < 3) {
          throw new BacktrackSignal(protectedTask, attempt + 1);
        }
        return attempt;
      });

      protectedTask = withErrorBoundary(backtrackingTask, [
        createErrorHandler(Error, () => 'error-caught')
      ]);

      // BacktrackSignal should not be caught by error boundary, should succeed with retries
      const result = await run(protectedTask, 1);
      expect(result).toBe(3); // Should succeed after retries
    });

    it('should rethrow unhandled errors', async () => {
      const CustomError = createErrorType<[string]>({ name: 'CustomError' });
      const OtherError = createErrorType<[string]>({ name: 'OtherError' });
      
      const failingTask = defineTask(async () => {
        throw new OtherError('Unhandled error type');
      });

      const protectedTask = withErrorBoundary(failingTask, [
        createErrorHandler(CustomError, () => 'handled')
      ]);

      await expect(run(protectedTask, undefined)).rejects.toThrow('Unhandled error type');
    });

    it('should pass context to error handlers', async () => {
      const TestError = createErrorType<[string]>({ name: 'TestError' });
      let capturedContext: TestContext | null = null;
      
      const failingTask = defineTask(async () => {
        throw new TestError('Test error');
      });

      const protectedTask = withErrorBoundary(failingTask, [
        createErrorHandler(TestError, (error, context) => {
          capturedContext = context;
          return 'handled';
        })
      ]);

      await run(protectedTask, undefined, { overrides: { userId: 'custom-user' } });
      
      expect(capturedContext).not.toBeNull();
      expect(capturedContext!.userId).toBe('custom-user');
    });

    it('should handle async error handlers', async () => {
      const AsyncError = createErrorType<[string]>({ name: 'AsyncError' });
      
      const failingTask = defineTask(async () => {
        throw new AsyncError('Async processing failed');
      });

      const protectedTask = withErrorBoundary(failingTask, [
        createErrorHandler(AsyncError, async (error, context) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          context.logger.warn('Async error processed');
          return 'async-fallback';
        })
      ]);

      const result = await run(protectedTask, undefined);
      expect(result).toBe('async-fallback');
      expect(mockLogger.warn).toHaveBeenCalledWith('Async error processed');
    });

    it('should work with successful tasks', async () => {
      const successTask = defineTask(async (input: string) => `success: ${input}`);

      const protectedTask = withErrorBoundary(successTask, [
        createErrorHandler(Error, () => 'error-fallback')
      ]);

      const result = await run(protectedTask, 'test');
      expect(result).toBe('success: test');
    });

    it('should handle non-Error thrown values', async () => {
      const throwingTask = defineTask(async () => {
        throw 'string error'; // Not an Error instance
      });

      const protectedTask = withErrorBoundary(throwingTask, [
        createErrorHandler(Error, () => 'error-handled')
      ]);

      // Non-Error throws should be rethrown (but wrapped in WorkflowError)
      await expect(run(protectedTask, undefined)).rejects.toThrow('string error');
    });

    it('should handle multiple error types in complex workflows', async () => {
      const NetworkError = createErrorType<[string]>({ name: 'NetworkError' });
      const ValidationError = createErrorType<[string]>({ name: 'ValidationError' });
      
      const multiFailTask = defineTask(async (errorType: string) => {
        switch (errorType) {
          case 'network':
            throw new NetworkError('Network failure');
          case 'validation':
            throw new ValidationError('Validation failure');
          default:
            return 'success';
        }
      });

      const protectedTask = withErrorBoundary(multiFailTask, [
        createErrorHandler(NetworkError, (error) => `Network: ${error.message}`),
        createErrorHandler(ValidationError, (error) => `Validation: ${error.message}`)
      ]);

      const networkResult = await run(protectedTask, 'network');
      const validationResult = await run(protectedTask, 'validation');
      const successResult = await run(protectedTask, 'success');

      expect(networkResult).toBe('Network: Network failure');
      expect(validationResult).toBe('Validation: Validation failure');
      expect(successResult).toBe('success');
    });
  });

  describe('tryCatch', () => {
    it('should convert successful sync functions to Ok results', async () => {
      const safeFn = tryCatch((x: number) => x * 2);
      const result = await safeFn(5);
      
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(10);
      }
    });

    it('should convert successful async functions to Ok results', async () => {
      const safeFn = tryCatch(async (x: number) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return x * 2;
      });
      
      const result = await safeFn(5);
      
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBe(10);
      }
    });

    it('should convert thrown errors to Err results', async () => {
      const safeFn = tryCatch(() => {
        throw new Error('Something went wrong');
      });
      
      const result = await safeFn();
      
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('Something went wrong');
      }
    });

    it('should convert async thrown errors to Err results', async () => {
      const safeFn = tryCatch(async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        throw new Error('Async error');
      });
      
      const result = await safeFn();
      
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('Async error');
      }
    });

    it('should handle non-Error thrown values', async () => {
      const safeFn = tryCatch(() => {
        throw 'string error';
      });
      
      const result = await safeFn();
      
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });

    it('should preserve function arguments', async () => {
      const safeFn = tryCatch((a: number, b: string, c: boolean) => {
        return { a, b, c };
      });
      
      const result = await safeFn(42, 'test', true);
      
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toEqual({ a: 42, b: 'test', c: true });
      }
    });

    it('should work with functions that return undefined', async () => {
      const safeFn = tryCatch(() => {
        return undefined;
      });
      
      const result = await safeFn();
      
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeUndefined();
      }
    });

    it('should work with functions that return null', async () => {
      const safeFn = tryCatch(() => {
        return null;
      });
      
      const result = await safeFn();
      
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value).toBeNull();
      }
    });

    it('should handle custom error types', async () => {
      const CustomError = createErrorType<[string]>({ name: 'CustomError' });
      const safeFn = tryCatch(() => {
        throw new CustomError('Custom error message');
      });
      
      const result = await safeFn();
      
      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error).toBeInstanceOf(CustomError);
        expect(result.error.name).toBe('CustomError');
        expect(result.error.message).toBe('Custom error message');
      }
    });

    it('should work with API-like functions', async () => {
      // Simulate an API call that might fail
      const apiCall = tryCatch(async (endpoint: string) => {
        if (endpoint === '/error') {
          throw new Error('API Error');
        }
        return { data: `Response from ${endpoint}`, status: 200 };
      });
      
      const successResult = await apiCall('/users');
      const errorResult = await apiCall('/error');
      
      expect(successResult.isOk()).toBe(true);
      if (successResult.isOk()) {
        expect(successResult.value).toEqual({ 
          data: 'Response from /users', 
          status: 200 
        });
      }
      
      expect(errorResult.isErr()).toBe(true);
      if (errorResult.isErr()) {
        expect(errorResult.error.message).toBe('API Error');
      }
    });
  });

  describe('Integration with task workflows', () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    it('should integrate error boundaries with complex workflows', async () => {
      const DatabaseError = createErrorType<[string]>({ name: 'DatabaseError' });
      const NetworkError = createErrorType<[string]>({ name: 'NetworkError' });
      
      const fetchDataTask = defineTask(async (source: string) => {
        switch (source) {
          case 'db':
            throw new DatabaseError('Database connection failed');
          case 'api':
            throw new NetworkError('Network timeout');
          default:
            return `Data from ${source}`;
        }
      });

      const resilientTask = withErrorBoundary(fetchDataTask, [
        createErrorHandler(DatabaseError, (error, context) => {
          context.logger.error('Database fallback triggered', error);
          return 'cached-data';
        }),
        createErrorHandler(NetworkError, (error, context) => {
          context.logger.error('Network fallback triggered', error);
          return 'offline-data';
        })
      ]);

      const dbResult = await run(resilientTask, 'db');
      const apiResult = await run(resilientTask, 'api');
      const normalResult = await run(resilientTask, 'memory');

      expect(dbResult).toBe('cached-data');
      expect(apiResult).toBe('offline-data');
      expect(normalResult).toBe('Data from memory');
      
      expect(mockLogger.error).toHaveBeenCalledTimes(2);
    });

    it('should combine tryCatch with task workflows', async () => {
      const riskyApiCall = (endpoint: string) => {
        if (endpoint.includes('error')) {
          throw new Error('API Error');
        }
        return Promise.resolve({ data: `Response from ${endpoint}` });
      };

      const safeApiCall = tryCatch(riskyApiCall);
      
      const apiTask = defineTask(async (endpoint: string) => {
        const result = await safeApiCall(endpoint);
        
        if (result.isErr()) {
          return { data: null, error: result.error.message };
        }
        
        return { data: result.value, error: null };
      });

      const successResult = await run(apiTask, '/users');
      const errorResult = await run(apiTask, '/error-endpoint');

      expect(successResult).toEqual({
        data: { data: 'Response from /users' },
        error: null
      });
      
      expect(errorResult).toEqual({
        data: null,
        error: 'API Error'
      });
    });
  });
});
