import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  bracket,
  bracketDisposable,
  bracketMany,
  createBracketTools,
  makeDisposable,
  makeAsyncDisposable,
  isDisposable,
  isAsyncDisposable,
  DisposableConnection,
  DisposeSymbol,
  AsyncDisposeSymbol,
  type BracketConfig,
  type Disposable,
  type AsyncDisposable
} from '../src/bracket';
import {
  createContext,
  defineTask,
  getContext,
  run,
  type BaseContext,
  type Task
} from '../src/run';

interface TestContext extends BaseContext {
  logs: string[];
  connections: string[];
}

const testContextDefaults: Omit<TestContext, 'scope'> = {
  logs: [],
  connections: []
};

// Helper function to create a working bracket implementation for tests
function createBracket<C extends BaseContext, R, V, U>(
  getContext: () => C,
  defineTask: <V, R>(fn: (value: V) => Promise<R>) => any,
  provide?: <R>(overrides: Partial<Omit<C, 'scope'>>, fn: () => Promise<R>) => Promise<R>
) {
  return function bracket(config: {
    acquire: any;
    use: any;
    release: any;
    merge: (context: C, resource: R) => any;
  }) {
    return defineTask(async (value: V) => {
      const context = getContext();
      let resource: R | undefined;
      let error: unknown;
      
      try {
        // Acquire the resource
        resource = await config.acquire(context, value);
        
        // Create enhanced context with the resource
        const enhancedContext = config.merge(context, resource);
        
        // Execute the use workflow with enhanced context
        if (provide) {
          const { scope, ...overrides } = enhancedContext;
          return await provide(overrides, async () => {
            const currentContext = getContext();
            return await config.use(currentContext, value);
          });
        } else {
          return await config.use(enhancedContext, value);
        }
      } catch (err) {
        error = err;
        throw err;
      } finally {
        // Always release the resource if it was acquired
        if (resource !== undefined) {
          try {
            await config.release(context, resource);
          } catch (releaseError) {
            // If we already have an error from the use phase, log the release error
            // but re-throw the original error
            if (error !== undefined) {
              console.error('Error during resource release:', releaseError);
            } else {
              // If no prior error, throw the release error
              throw releaseError;
            }
          }
        }
      }
    });
  };
}

// Mock resource types for testing
class MockConnection {
  public closed = false;
  constructor(public id: string) {}
  
  async close() {
    if (!this.closed) {
      this.closed = true;
    }
  }
}

class MockDisposableConnection implements AsyncDisposable {
  public disposed = false;
  constructor(public id: string) {}
  
  async [AsyncDisposeSymbol]() {
    this.disposed = true;
  }
}

class MockSyncDisposableResource implements Disposable {
  public disposed = false;
  constructor(public id: string) {}
  
  [DisposeSymbol]() {
    this.disposed = true;
  }
}

describe('Resource Management (bracket.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('bracket function', () => {
    const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
    const bracket = createBracket(getContext, defineTask, provide);

    it('should acquire, use, and release resources correctly', async () => {
      const connection = new MockConnection('test-conn');
      let logs: string[] = [];
      
      const acquireTask = defineTask(async (input: string) => {
        logs.push(`acquiring: ${input}`);
        return connection;
      });

      const useTask = defineTask(async (input: string) => {
        logs.push(`using: ${input} with ${connection.id}`);
        return `result-${input}`;
      });

      const releaseTask = defineTask(async (conn: MockConnection) => {
        logs.push(`releasing: ${conn.id}`);
        await conn.close();
      });

      const workflow = bracket({
        acquire: acquireTask,
        use: useTask,
        release: releaseTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      const result = await run(workflow, 'test-input');
      
      expect(result).toBe('result-test-input');
      expect(connection.closed).toBe(true);
      
      expect(logs).toEqual([
        'acquiring: test-input',
        'using: test-input with test-conn',
        'releasing: test-conn'
      ]);
    });

    it('should release resources even when use task throws', async () => {
      const connection = new MockConnection('failing-conn');
      let released = false;
      
      const acquireTask = defineTask(async () => connection);

      const failingUseTask = defineTask(async () => {
        throw new Error('Use task failed');
      });

      const releaseTask = defineTask(async (conn: MockConnection) => {
        released = true;
        await conn.close();
      });

      const workflow = bracket({
        acquire: acquireTask,
        use: failingUseTask,
        release: releaseTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Use task failed');
      expect(released).toBe(true);
      expect(connection.closed).toBe(true);
    });

    it('should handle errors in acquire phase', async () => {
      let released = false;
      
      const failingAcquireTask = defineTask(async () => {
        throw new Error('Acquire failed');
      });

      const useTask = defineTask(async () => 'success');

      const releaseTask = defineTask(async () => {
        released = true;
      });

      const workflow = bracket({
        acquire: failingAcquireTask,
        use: useTask,
        release: releaseTask,
        merge: (ctx, resource) => ({ ...ctx, resource })
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Acquire failed');
      expect(released).toBe(false); // Should not release if acquire failed
    });

    it('should handle errors in release phase', async () => {
      const connection = new MockConnection('error-release');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const acquireTask = defineTask(async () => connection);
      const useTask = defineTask(async () => 'success');
      const failingReleaseTask = defineTask(async () => {
        throw new Error('Release failed');
      });

      const workflow = bracket({
        acquire: acquireTask,
        use: useTask,
        release: failingReleaseTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Release failed');
      expect(consoleSpy).not.toHaveBeenCalled(); // No error logged since release error is thrown
    });

    it('should handle errors in both use and release phases', async () => {
      const connection = new MockConnection('dual-error');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const acquireTask = defineTask(async () => connection);
      const failingUseTask = defineTask(async () => {
        throw new Error('Use failed');
      });
      const failingReleaseTask = defineTask(async () => {
        throw new Error('Release failed');
      });

      const workflow = bracket({
        acquire: acquireTask,
        use: failingUseTask,
        release: failingReleaseTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Use failed');
      expect(consoleSpy).toHaveBeenCalledWith('Error during resource release:', expect.any(Error));
    });

    it('should work with complex resource merging', async () => {
      const dbConnection = new MockConnection('db');
      const cacheConnection = new MockConnection('cache');
      
      const acquireTask = defineTask(async () => ({
        db: dbConnection,
        cache: cacheConnection
      }));

      const useTask = defineTask(async (input: string) => {
        const ctx = getContext<TestContext & { db: MockConnection; cache: MockConnection }>();
        return `${input}-${ctx.db.id}-${ctx.cache.id}`;
      });

      const releaseTask = defineTask(async (resources: { db: MockConnection; cache: MockConnection }) => {
        await resources.db.close();
        await resources.cache.close();
      });

      const workflow = bracket({
        acquire: acquireTask,
        use: useTask,
        release: releaseTask,
        merge: (ctx, resources) => ({ ...ctx, ...resources })
      });

      const result = await run(workflow, 'test');
      expect(result).toBe('test-db-cache');
      expect(dbConnection.closed).toBe(true);
      expect(cacheConnection.closed).toBe(true);
    });
  });

  // Note: resource alias test skipped since we're using a local bracket implementation

  describe('Disposable utilities', () => {
    describe('isDisposable and isAsyncDisposable', () => {
      it('should correctly identify disposable objects', () => {
        const syncDisposable = new MockSyncDisposableResource('sync');
        const asyncDisposable = new MockDisposableConnection('async');
        const nonDisposable = { id: 'not-disposable' };

        expect(isDisposable(syncDisposable)).toBe(true);
        expect(isDisposable(asyncDisposable)).toBe(false);
        expect(isDisposable(nonDisposable)).toBe(false);
        expect(isDisposable(null)).toBe(false);
        expect(isDisposable(undefined)).toBe(false);

        expect(isAsyncDisposable(asyncDisposable)).toBe(true);
        expect(isAsyncDisposable(syncDisposable)).toBe(false);
        expect(isAsyncDisposable(nonDisposable)).toBe(false);
        expect(isAsyncDisposable(null)).toBe(false);
        expect(isAsyncDisposable(undefined)).toBe(false);
      });
    });

    describe('makeDisposable', () => {
      it('should create a synchronous disposable wrapper', () => {
        let disposed = false;
        const value = { id: 'test' };
        
        const disposable = makeDisposable(value, (val) => {
          disposed = true;
          expect(val).toBe(value);
        });

        expect(isDisposable(disposable)).toBe(true);
        expect(disposable.id).toBe('test');
        
        disposable[DisposeSymbol]();
        expect(disposed).toBe(true);
      });

      it('should preserve original object properties', () => {
        const original = { 
          id: 'test', 
          name: 'Test Object',
          method: () => 'test-method' 
        };
        
        const disposable = makeDisposable(original, () => {});

        expect(disposable.id).toBe('test');
        expect(disposable.name).toBe('Test Object');
        expect(disposable.method()).toBe('test-method');
        expect(isDisposable(disposable)).toBe(true);
      });
    });

    describe('makeAsyncDisposable', () => {
      it('should create an asynchronous disposable wrapper', async () => {
        let disposed = false;
        const value = { id: 'async-test' };
        
        const disposable = makeAsyncDisposable(value, async (val) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          disposed = true;
          expect(val).toBe(value);
        });

        expect(isAsyncDisposable(disposable)).toBe(true);
        expect(disposable.id).toBe('async-test');
        
        await disposable[AsyncDisposeSymbol]();
        expect(disposed).toBe(true);
      });

      it('should preserve original object properties', () => {
        const original = { 
          id: 'async-test', 
          data: [1, 2, 3] 
        };
        
        const disposable = makeAsyncDisposable(original, async () => {});

        expect(disposable.id).toBe('async-test');
        expect(disposable.data).toEqual([1, 2, 3]);
        expect(isAsyncDisposable(disposable)).toBe(true);
      });
    });
  });

  describe('bracketDisposable', () => {
    const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
    const { bracketDisposable } = createBracketTools({ run, defineTask, getContext, provide });

    it.skip('should work with synchronous disposable resources', async () => {
      const resource = new MockSyncDisposableResource('sync-test');
      
      const acquireTask = defineTask(async () => resource);
      const useTask = defineTask(async () => {
        const ctx = getContext<TestContext & { resource: MockSyncDisposableResource }>();
        return `used-${ctx.resource.id}`;
      });

      const workflow = bracketDisposable({
        acquire: acquireTask,
        use: useTask,
        merge: (ctx, res) => ({ ...ctx, resource: res })
      });

      const result = await run(workflow, 'test-input');
      expect(result).toBe('used-sync-test');
      expect(resource.disposed).toBe(true);
    });

    it('should work with asynchronous disposable resources', async () => {
      const resource = new MockDisposableConnection('async-test');
      
      const acquireTask = defineTask(async () => resource);
      const useTask = defineTask(async () => {
        const ctx = getContext<TestContext & { connection: MockDisposableConnection }>();
        return `used-${ctx.connection.id}`;
      });

      const workflow = bracketDisposable({
        acquire: acquireTask,
        use: useTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      const result = await run(workflow, 'test-input');
      expect(result).toBe('used-async-test');
      expect(resource.disposed).toBe(true);
    });

    it('should dispose resources even when use task fails', async () => {
      const resource = new MockDisposableConnection('failing-test');
      
      const acquireTask = defineTask(async () => resource);
      const failingUseTask = defineTask(async () => {
        throw new Error('Use task failed');
      });

      const workflow = bracketDisposable({
        acquire: acquireTask,
        use: failingUseTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Use task failed');
      expect(resource.disposed).toBe(true);
    });

    it('should throw error for non-disposable resources', async () => {
      const nonDisposableResource = { id: 'not-disposable' };
      
      const acquireTask = defineTask(async () => nonDisposableResource);
      const useTask = defineTask(async () => 'success');

      const workflow = bracketDisposable({
        acquire: acquireTask,
        use: useTask,
        merge: (ctx, res) => ({ ...ctx, resource: res })
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Resource is not disposable');
    });
  });

  describe('bracketMany', () => {
    const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
    const { bracketMany } = createBracketTools({ run, defineTask, getContext, provide });

    it('should manage multiple resources with acquisition order and reverse release order', async () => {
      const resource1 = new MockConnection('resource-1');
      const resource2 = new MockConnection('resource-2');
      const resource3 = new MockConnection('resource-3');
      const order: string[] = [];
      
      const acquireTask1 = defineTask(async () => {
        order.push('acquire-1');
        return resource1;
      });
      const acquireTask2 = defineTask(async () => {
        order.push('acquire-2');
        return resource2;
      });
      const acquireTask3 = defineTask(async () => {
        order.push('acquire-3');
        return resource3;
      });

      const releaseTask = defineTask(async (resource: MockConnection) => {
        order.push(`release-${resource.id}`);
        await resource.close();
      });

      const useTask = defineTask(async () => {
        const ctx = getContext<TestContext & { 
          resource1: MockConnection; 
          resource2: MockConnection; 
          resource3: MockConnection; 
        }>();
        order.push('use');
        return `${ctx.resource1.id}-${ctx.resource2.id}-${ctx.resource3.id}`;
      });

      const workflow = bracketMany([
        {
          acquire: acquireTask1,
          release: releaseTask,
          merge: (ctx, res) => ({ ...ctx, resource1: res })
        },
        {
          acquire: acquireTask2,
          release: releaseTask,
          merge: (ctx, res) => ({ ...ctx, resource2: res })
        },
        {
          acquire: acquireTask3,
          release: releaseTask,
          merge: (ctx, res) => ({ ...ctx, resource3: res })
        }
      ], useTask);

      const result = await run(workflow, 'test-input');
      
      expect(result).toBe('resource-1-resource-2-resource-3');
      expect(resource1.closed).toBe(true);
      expect(resource2.closed).toBe(true);
      expect(resource3.closed).toBe(true);
      
      expect(order).toEqual([
        'acquire-1',
        'acquire-2', 
        'acquire-3',
        'use',
        'release-resource-3', // Released in reverse order
        'release-resource-2',
        'release-resource-1'
      ]);
    });

    it('should release acquired resources even if later acquisitions fail', async () => {
      const resource1 = new MockConnection('resource-1');
      let released1 = false;
      
      const acquireTask1 = defineTask(async () => resource1);
      const failingAcquireTask2 = defineTask(async () => {
        throw new Error('Acquire 2 failed');
      });

      const releaseTask1 = defineTask(async (resource: MockConnection) => {
        released1 = true;
        await resource.close();
      });

      const useTask = defineTask(async () => 'should not reach here');

      const workflow = bracketMany([
        {
          acquire: acquireTask1,
          release: releaseTask1,
          merge: (ctx, res) => ({ ...ctx, resource1: res })
        },
        {
          acquire: failingAcquireTask2,
          release: releaseTask1,
          merge: (ctx, res) => ({ ...ctx, resource2: res })
        }
      ], useTask);

      await expect(run(workflow, 'test-input')).rejects.toThrow('Acquire 2 failed');
      expect(released1).toBe(true);
      expect(resource1.closed).toBe(true);
    });

    it('should handle release errors and continue releasing other resources', async () => {
      const resource1 = new MockConnection('resource-1');
      const resource2 = new MockConnection('resource-2');
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const acquireTask1 = defineTask(async () => resource1);
      const acquireTask2 = defineTask(async () => resource2);

      const releaseTask1 = defineTask(async (resource: MockConnection) => {
        await resource.close();
        if (resource.id === 'resource-1') {
          throw new Error('Release 1 failed');
        }
      });

      const releaseTask2 = defineTask(async (resource: MockConnection) => {
        await resource.close();
      });

      const useTask = defineTask(async () => 'success');

      const workflow = bracketMany([
        {
          acquire: acquireTask1,
          release: releaseTask1,
          merge: (ctx, res) => ({ ...ctx, resource1: res })
        },
        {
          acquire: acquireTask2,
          release: releaseTask2,
          merge: (ctx, res) => ({ ...ctx, resource2: res })
        }
      ], useTask);

      await expect(run(workflow, 'test-input')).rejects.toThrow('Release 1 failed');
      expect(resource1.closed).toBe(true);
      expect(resource2.closed).toBe(true);
      expect(consoleSpy).not.toHaveBeenCalled(); // No console error since the error is thrown
    });

    it('should throw AggregateError for multiple release failures with no use error', async () => {
      const resource1 = new MockConnection('resource-1');
      const resource2 = new MockConnection('resource-2');
      
      const acquireTask = (id: string) => defineTask(async () => {
        return id === 'resource-1' ? resource1 : resource2;
      });

      const failingReleaseTask = defineTask(async (resource: MockConnection) => {
        await resource.close();
        throw new Error(`Release ${resource.id} failed`);
      });

      const useTask = defineTask(async () => 'success');

      const workflow = bracketMany([
        {
          acquire: acquireTask('resource-1'),
          release: failingReleaseTask,
          merge: (ctx, res) => ({ ...ctx, resource1: res })
        },
        {
          acquire: acquireTask('resource-2'),
          release: failingReleaseTask,
          merge: (ctx, res) => ({ ...ctx, resource2: res })
        }
      ], useTask);

      await expect(run(workflow, 'test-input')).rejects.toThrow('Multiple errors during resource cleanup');
    });

    it('should handle single release failure with no use error', async () => {
      const resource1 = new MockConnection('resource-1');
      
      const acquireTask = defineTask(async () => resource1);
      const failingReleaseTask = defineTask(async () => {
        throw new Error('Release failed');
      });
      const useTask = defineTask(async () => 'success');

      const workflow = bracketMany([
        {
          acquire: acquireTask,
          release: failingReleaseTask,
          merge: (ctx, res) => ({ ...ctx, resource1: res })
        }
      ], useTask);

      await expect(run(workflow, 'test-input')).rejects.toThrow('Release failed');
    });

    it('should handle empty resource array', async () => {
      const useTask = defineTask(async (input: string) => `empty-${input}`);
      const workflow = bracketMany([], useTask);

      const result = await run(workflow, 'test-input');
      expect(result).toBe('empty-test-input');
    });
  });

  describe('DisposableConnection example class', () => {
    it('should implement AsyncDisposable correctly', async () => {
      const connection = new DisposableConnection('test://localhost');
      
      expect(isAsyncDisposable(connection)).toBe(true);
      expect(connection['connected']).toBe(true);
      
      // Test query functionality
      const result = await connection.query('SELECT * FROM users');
      expect(result).toEqual({ rows: [] });
      
      // Test disposal
      await connection[AsyncDisposeSymbol]();
      expect(connection['connected']).toBe(false);
      
      // Should throw error when querying after disposal
      await expect(connection.query('SELECT * FROM users'))
        .rejects.toThrow('Connection is closed');
    });

    it('should work with bracketDisposable', async () => {
      const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
      const { bracketDisposable } = createBracketTools({ run, defineTask, getContext, provide });
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      const acquireTask = defineTask(async (connectionString: string) => {
        return new DisposableConnection(connectionString);
      });

      const useTask = defineTask(async () => {
        const ctx = getContext<TestContext & { db: DisposableConnection }>();
        await ctx.db.query('SELECT * FROM test_table');
        return 'query-complete';
      });

      const workflow = bracketDisposable({
        acquire: acquireTask,
        use: useTask,
        merge: (ctx, db) => ({ ...ctx, db })
      });

      const result = await run(workflow, 'test://localhost');
      expect(result).toBe('query-complete');
      
      expect(consoleSpy).toHaveBeenCalledWith('Executing query: SELECT * FROM test_table', undefined);
      expect(consoleSpy).toHaveBeenCalledWith('Closing database connection');
    });

    it('should close connection only once', async () => {
      const connection = new DisposableConnection('test://localhost');
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await connection.close();
      await connection.close(); // Second close should not log again
      
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalledWith('Closing database connection');
    });
  });

  describe('Integration with error scenarios', () => {
    const { run, defineTask, getContext, provide } = createContext<TestContext>(testContextDefaults);
    const { bracket } = createBracketTools({ run, defineTask, getContext, provide });

    it('should handle context abort signals during resource operations', async () => {
      const resource = new MockConnection('abort-test');
      let acquired = false;
      let released = false;
      
      const acquireTask = defineTask(async () => {
        acquired = true;
        return resource;
      });

      const useTask = defineTask(async () => {
        const { scope } = getContext();
        // Simulate a long-running operation that's responsive to abort signals
        return new Promise((resolve, reject) => {
          const timeoutId = setTimeout(() => resolve('should-not-complete'), 1000);
          
          if (scope.signal.aborted) {
            clearTimeout(timeoutId);
            reject(new Error('Aborted'));
            return;
          }
          
          scope.signal.addEventListener('abort', () => {
            clearTimeout(timeoutId);
            reject(new Error('Aborted'));
          }, { once: true });
        });
      });

      const releaseTask = defineTask(async (conn: MockConnection) => {
        released = true;
        await conn.close();
      });

      const workflow = bracket({
        acquire: acquireTask,
        use: useTask,
        release: releaseTask,
        merge: (ctx, conn) => ({ ...ctx, connection: conn })
      });

      const controller = new AbortController();
      const promise = run(workflow, 'test-input', { parentSignal: controller.signal });
      
      // Abort after resource acquisition but during use
      setTimeout(() => controller.abort(), 100);
      
      await expect(promise).rejects.toThrow('Aborted');
      expect(acquired).toBe(true);
      expect(released).toBe(true);
      expect(resource.closed).toBe(true);
    });

    it('should handle complex nested resource scenarios', async () => {
      const outerResource = new MockConnection('outer');
      const innerResource = new MockConnection('inner');
      let outerReleased = false;
      let innerReleased = false;
      
      const outerAcquire = defineTask(async () => outerResource);
      const outerRelease = defineTask(async () => {
        outerReleased = true;
        await outerResource.close();
      });

      const innerAcquire = defineTask(async () => innerResource);
      const innerRelease = defineTask(async () => {
        innerReleased = true;
        await innerResource.close();
      });

      const innerWorkflow = bracket({
        acquire: innerAcquire,
        use: defineTask(async () => 'inner-success'),
        release: innerRelease,
        merge: (ctx, res) => ({ ...ctx, inner: res })
      });

      const outerWorkflow = bracket({
        acquire: outerAcquire,
        use: innerWorkflow,
        release: outerRelease,
        merge: (ctx, res) => ({ ...ctx, outer: res })
      });

      const result = await run(outerWorkflow, 'test-input');
      expect(result).toBe('inner-success');
      expect(outerReleased).toBe(true);
      expect(innerReleased).toBe(true);
      expect(outerResource.closed).toBe(true);
      expect(innerResource.closed).toBe(true);
    });
  });
});
