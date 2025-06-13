import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  withResource,
  withDisposableResource,
  withResources,
  asAsyncDisposable,
  createResource,
  mergeIntoContext,
  isDisposable,
  isAsyncDisposable,
  DisposeSymbol,
  AsyncDisposeSymbol,
  DatabaseConnection,
  type Disposable,
  type AsyncDisposable,
} from '../src/bracket';
import {
  createContext,
  defineTask,
  getContext,
  run,
  type BaseContext,
} from '../src/run';

// Mock resource types for testing
class MockConnection {
  public closed = false;
  constructor(public id: string) { }
  async close() { this.closed = true; }
}

class MockSyncDisposableResource implements Disposable {
  public disposed = false;
  constructor(public id: string) { }
  [DisposeSymbol]() { this.disposed = true; }
}

interface TestContext extends BaseContext {
  logs: string[];
}

const testContextDefaults: Omit<TestContext, 'scope'> = {
  logs: [],
};

describe('Resource Management (bracket.ts)', () => {
  const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('withResource (bracket)', () => {
    it('should acquire, use, and release resources correctly', async () => {
      const connection = new MockConnection('test-conn');
      let logs: string[] = [];

      const acquireTask = defineTask(async (input: string) => {
        logs.push(`acquiring: ${input}`);
        return connection;
      });

      const useTask = defineTask(async (input: string) => {
        const ctx = getContext() as TestContext & { db: MockConnection };
        logs.push(`using: ${input} with ${ctx.db.id}`);
        return `result-${input}`;
      });

      const releaseTask = defineTask(async (conn: MockConnection) => {
        logs.push(`releasing: ${conn.id}`);
        await conn.close();
      });

      const workflow = withResource({
        acquire: acquireTask,
        use: useTask,
        release: releaseTask,
        merge: mergeIntoContext('db'),
      });

      const result = await run(workflow, 'test-input');

      expect(result).toBe('result-test-input');
      expect(connection.closed).toBe(true);
      expect(logs).toEqual(['acquiring: test-input', 'using: test-input with test-conn', 'releasing: test-conn']);
    });

    it('should release resources even when use task throws', async () => {
      const connection = new MockConnection('failing-conn');
      const releaseSpy = vi.spyOn(connection, 'close');

      const workflow = withResource({
        acquire: defineTask(async () => connection),
        use: defineTask(async () => { throw new Error('Use task failed'); }),
        // FIX: Explicitly type the `conn` parameter.
        release: defineTask(async (conn: MockConnection) => conn.close()),
        merge: mergeIntoContext('db'),
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Use task failed');
      expect(releaseSpy).toHaveBeenCalledOnce();
      expect(connection.closed).toBe(true);
    });

    it('should handle errors in acquire phase', async () => {
      let released = false;
      const failingAcquireTask = defineTask(async () => { throw new Error('Acquire failed'); });
      const releaseTask = defineTask(async () => { released = true; });

      const workflow = withResource({
        acquire: failingAcquireTask,
        use: defineTask(async () => 'success'),
        release: releaseTask,
        merge: mergeIntoContext('resource'),
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Acquire failed');
      expect(released).toBe(false);
    });

    it('should handle errors in release phase', async () => {
      const failingReleaseTask = defineTask(async () => { throw new Error('Release failed'); });

      const workflow = withResource({
        acquire: defineTask(async () => new MockConnection('error-release')),
        use: defineTask(async () => 'success'),
        release: failingReleaseTask,
        merge: mergeIntoContext('db'),
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Release failed');
    });

    it('should handle errors in both use and release phases', async () => {
      const workflow = withResource({
        acquire: defineTask(async () => new MockConnection('dual-error')),
        use: defineTask(async () => { throw new Error('Use failed'); }),
        release: defineTask(async () => { throw new Error('Release failed'); }),
        merge: mergeIntoContext('db'),
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow(AggregateError);
      await expect(run(workflow, 'test-input')).rejects.toThrow('An error occurred during the "use" phase, and a subsequent error occurred during the "release" phase.');
    });

    it('should work with complex resource merging', async () => {
      const dbConnection = new MockConnection('db');
      const cacheConnection = new MockConnection('cache');

      const acquireTask = defineTask(async () => ({
        db: dbConnection,
        cache: cacheConnection
      }));

      type MergedContext = TestContext & { db: MockConnection; cache: MockConnection };
      const useTask = defineTask(async (input: string) => {
        const ctx = getContext() as MergedContext;
        return `${input}-${ctx.db.id}-${ctx.cache.id}`;
      });

      const releaseTask = defineTask(async (resources: { db: MockConnection; cache: MockConnection }) => {
        await resources.db.close();
        await resources.cache.close();
      });

      const workflow = withResource({
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

  describe('Disposable and helper functions', () => {
    it('isDisposable and isAsyncDisposable should work correctly', () => {
      const sync = new MockSyncDisposableResource('sync');
      const asyncConn = new DatabaseConnection('');
      expect(isDisposable(sync)).toBe(true);
      expect(isAsyncDisposable(sync)).toBe(false);
      expect(isAsyncDisposable(asyncConn)).toBe(true);
    });

    it('asAsyncDisposable should adapt an object with a cleanup method', async () => {
      class ApiClient {
        isActive = true;
        disconnect = vi.fn(async () => { this.isActive = false; });
      }
      const client = new ApiClient();
      const disposableClient = asAsyncDisposable(client, 'disconnect');

      expect(isAsyncDisposable(disposableClient)).toBe(true);
      await disposableClient[AsyncDisposeSymbol]();
      expect(client.disconnect).toHaveBeenCalledOnce();
      expect(client.isActive).toBe(false);
    });

    it('createResource should create a valid resource definition', async () => {
      const acquireTask = defineTask(async () => new MockConnection('test'));
      const releaseTask = defineTask(async (conn: MockConnection) => conn.close());
      const resourceDef = createResource('db', acquireTask, releaseTask);

      expect(resourceDef.acquire).toBe(acquireTask);
      expect(resourceDef.release).toBe(releaseTask);
      expect(typeof resourceDef.merge).toBe('function');

      const merged = resourceDef.merge({ scope: { signal: new AbortController().signal }, logs: [] }, new MockConnection('merged'));
      expect(merged).toHaveProperty('db');
    });
  });

  describe('withDisposableResource', () => {
    it('should work with synchronous disposable resources', async () => {
      const resource = new MockSyncDisposableResource('sync-test');

      const workflow = withDisposableResource({
        acquire: defineTask(async () => resource),
        use: defineTask(async () => {
          const ctx = getContext() as TestContext & { resource: MockSyncDisposableResource };
          return `used-${ctx.resource.id}`;
        }),
        merge: mergeIntoContext('resource'),
      });

      const result = await run(workflow, null);
      expect(result).toBe('used-sync-test');
      expect(resource.disposed).toBe(true);
    });

    it('should work with asynchronous disposable resources', async () => {
      const resource = new DatabaseConnection('async-test');
      const spy = vi.spyOn(resource, AsyncDisposeSymbol);

      const workflow = withDisposableResource({
        acquire: defineTask(async () => resource),
        use: defineTask(async () => {
          const ctx = getContext() as TestContext & { db: DatabaseConnection };
          return `used-${ctx.db.connectionString}`;
        }),
        merge: mergeIntoContext('db'),
      });

      const result = await run(workflow, 'test-input');
      expect(result).toBe('used-async-test');
      expect(spy).toHaveBeenCalledOnce();
    });

    it('should dispose resources even when use task fails', async () => {
      const resource = new DatabaseConnection('failing-test');
      const spy = vi.spyOn(resource, AsyncDisposeSymbol);

      const workflow = withDisposableResource({
        acquire: defineTask(async () => resource),
        use: defineTask(async () => { throw new Error('Use task failed'); }),
        merge: mergeIntoContext('db'),
      });

      await expect(run(workflow, 'test-input')).rejects.toThrow('Use task failed');
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe('withResources (bracketMany)', () => {
    it('should manage multiple resources correctly', async () => {
      const order: string[] = [];
      const dbResource = createResource('db',
        defineTask(async () => { order.push('acq db'); return new MockConnection('db'); }),
        defineTask(async (resource: MockConnection) => { order.push('rel db'); await resource.close(); })
      );
      const cacheResource = createResource('cache',
        defineTask(async () => { order.push('acq cache'); return new MockConnection('cache'); }),
        defineTask(async (resource: MockConnection) => { order.push('rel cache'); await resource.close(); })
      );

      const useTask = defineTask(async () => {
        type MergedContext = TestContext & { db: MockConnection; cache: MockConnection; };
        const ctx = getContext() as MergedContext;
        order.push('use');
        return `${ctx.db.id}-${ctx.cache.id}`;
      });

      const workflow = withResources([dbResource, cacheResource], useTask);
      const result = await run(workflow, null);

      expect(result).toBe('db-cache');
      expect(order).toEqual(['acq db', 'acq cache', 'use', 'rel cache', 'rel db']);
    });

    it('should release acquired resources if a later acquisition fails', async () => {
      const order: string[] = [];
      const dbResource = createResource('db',
        defineTask(async () => { order.push('acq db'); return new MockConnection('db'); }),
        defineTask(async (_resource: MockConnection) => { order.push('rel db'); })
      );
      const failingResource = createResource('cache',
        defineTask(async () => { order.push('acq cache'); throw new Error('Cache acquire failed'); }),
        defineTask(async (_resource: MockConnection) => { order.push('rel cache'); })
      );

      const useTask = defineTask(async () => 'should-not-run');
      const workflow = withResources([dbResource, failingResource], useTask);

      await expect(run(workflow, null)).rejects.toThrow('Cache acquire failed');
      expect(order).toEqual(['acq db', 'acq cache', 'rel db']);
    });
  });

  describe('DatabaseConnection example class', () => {
    it('should be constructable and disposable', async () => {
      const conn = new DatabaseConnection('test-db');
      await conn.connect();
      const spy = vi.spyOn(console, 'log').mockImplementation(() => { });

      await conn[AsyncDisposeSymbol]();

      expect(spy).toHaveBeenCalledWith('Closing database connection');
      spy.mockRestore();
    });
  });
});