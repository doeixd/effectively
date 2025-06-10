# Effectively Bracket - Resource Management

## Overview

The `bracket` module provides robust resource management for async workflows in Effectively. It implements the acquire-use-release pattern, ensuring resources are properly cleaned up even when errors occur. The module also supports the TC39 Explicit Resource Management proposal, making it future-ready for native JavaScript resource management.

## Table of Contents

- [Core Concepts](#core-concepts)
- [Basic Usage](#basic-usage)
- [API Reference](#api-reference)
- [Advanced Patterns](#advanced-patterns)
- [Explicit Resource Management](#explicit-resource-management)
- [Best Practices](#best-practices)
- [Examples](#examples)

## Core Concepts

### The Resource Management Problem

In async applications, resources like database connections, file handles, or locks need careful management:

1. **Acquire** - Obtain the resource (open connection, acquire lock)
2. **Use** - Perform operations with the resource
3. **Release** - Clean up the resource (close connection, release lock)

The challenge is ensuring step 3 always happens, even if step 2 throws an error.

### The Bracket Solution

The `bracket` pattern solves this by structuring code into three explicit phases and guaranteeing the release phase executes regardless of success or failure:

```typescript
const result = bracket({
  acquire: getResource,
  use: useResource,
  release: cleanupResource,
  merge: (context, resource) => ({ ...context, resource })
});
```

## Basic Usage

### Simple Database Connection Example

```typescript
import { bracket, defineTask, getContext } from 'effectively';
import { DbConnection } from './db';

// Define resource management tasks
const acquireDb = defineTask(async () => {
  const { config } = getContext();
  const connection = new DbConnection(config.dbUrl);
  await connection.connect();
  return connection;
});

const releaseDb = defineTask(async (connection: DbConnection) => {
  await connection.close();
});

// Define tasks that use the resource
const getUser = defineTask(async (userId: string) => {
  const { db } = getContext(); // db is available on context!
  return db.query('SELECT * FROM users WHERE id = ?', [userId]);
});

// Create a bracketed workflow
const withDatabase = bracket({
  acquire: acquireDb,
  use: getUser,
  release: releaseDb,
  merge: (ctx, db) => ({ ...ctx, db })
});

// Use it
const user = await run(withDatabase, 'user-123');
```

### File Handling Example

```typescript
const withFile = bracket({
  acquire: defineTask(async (filename: string) => {
    return await fs.open(filename, 'r');
  }),
  
  use: defineTask(async (filename: string) => {
    const { file } = getContext();
    const content = await file.readFile({ encoding: 'utf8' });
    return content.length;
  }),
  
  release: defineTask(async (file: FileHandle) => {
    await file.close();
  }),
  
  merge: (ctx, file) => ({ ...ctx, file })
});

const fileSize = await run(withFile, 'data.txt');
```

## API Reference

### `bracket<C, R, V, U>(config: BracketConfig<C, R, V, U>): Task<C, V, U>`

Creates a task that implements the acquire-use-release pattern.

#### Parameters

- `config.acquire: Task<C, V, R>` - Task that acquires the resource
- `config.use: Task<C & any, V, U>` - Task that uses the resource
- `config.release: Task<C, R, void>` - Task that releases the resource
- `config.merge: (context: C, resource: R) => C & any` - Function to add resource to context

#### Returns

A new task that manages the complete resource lifecycle.

#### Behavior

1. Executes `acquire` with the input value
2. Calls `merge` to create an enhanced context with the resource
3. Executes `use` with the enhanced context
4. Always executes `release`, even if `use` throws
5. Returns the result from `use` or re-throws any error

### `bracketDisposable<C, R, V, U>(config): Task<C, V, U>`

Creates a bracket for resources implementing the Disposable/AsyncDisposable interface.

```typescript
class Connection implements AsyncDisposable {
  async [Symbol.asyncDispose]() {
    await this.close();
  }
}

const withConn = bracketDisposable({
  acquire: async () => new Connection(),
  use: performQueries,
  merge: (ctx, conn) => ({ ...ctx, conn })
});
```

### `bracketMany<C, V, U>(resources, use): Task<C, V, U>`

Manages multiple resources with automatic cleanup in reverse order.

```typescript
const withResources = bracketMany([
  {
    acquire: getDatabase,
    release: closeDatabase,
    merge: (ctx, db) => ({ ...ctx, db })
  },
  {
    acquire: getCache,
    release: closeCache,
    merge: (ctx, cache) => ({ ...ctx, cache })
  },
  {
    acquire: getMessageQueue,
    release: closeQueue,
    merge: (ctx, queue) => ({ ...ctx, queue })
  }
], complexOperation);
```

### Disposable Utilities

#### `makeDisposable<T>(value: T, dispose: (value: T) => void): T & Disposable`

Creates a disposable wrapper around any value.

```typescript
const disposableSocket = makeDisposable(
  new WebSocket(url),
  socket => socket.close()
);
```

#### `makeAsyncDisposable<T>(value: T, dispose: (value: T) => Promise<void>): T & AsyncDisposable`

Creates an async disposable wrapper.

```typescript
const disposableClient = makeAsyncDisposable(
  new ApiClient(),
  async client => await client.disconnect()
);
```

## Advanced Patterns

### Nested Resources

Resources can be nested by composing brackets:

```typescript
const innerWorkflow = bracket({
  acquire: acquireTransaction,
  use: performTransactionWork,
  release: commitOrRollback,
  merge: (ctx, tx) => ({ ...ctx, transaction: tx })
});

const outerWorkflow = bracket({
  acquire: acquireConnection,
  use: innerWorkflow,
  release: releaseConnection,
  merge: (ctx, conn) => ({ ...ctx, connection: conn })
});
```

### Conditional Resource Acquisition

```typescript
const withOptionalCache = defineTask(async (useCache: boolean) => {
  if (useCache) {
    return bracket({
      acquire: connectToCache,
      use: cachedOperation,
      release: disconnectCache,
      merge: (ctx, cache) => ({ ...ctx, cache })
    });
  } else {
    return directOperation;
  }
});
```

### Resource Pools

```typescript
const withPooledConnection = bracket({
  acquire: defineTask(async () => {
    const { pool } = getContext();
    return pool.acquire();
  }),
  
  use: databaseOperation,
  
  release: defineTask(async (conn) => {
    const { pool } = getContext();
    pool.release(conn);
  }),
  
  merge: (ctx, conn) => ({ ...ctx, connection: conn })
});
```

### Error Handling in Release

```typescript
const safeRelease = defineTask(async (resource: Resource) => {
  try {
    await resource.close();
  } catch (error) {
    // Log but don't throw - prevents masking the original error
    const { logger } = getContext();
    logger.error('Failed to close resource', error);
  }
});
```

## Explicit Resource Management

### Working with Symbol.dispose

The module fully supports the TC39 Explicit Resource Management proposal:

```typescript
// Define a disposable resource
export class TempFile implements Disposable {
  constructor(private path: string) {}
  
  [Symbol.dispose]() {
    fs.unlinkSync(this.path);
  }
}

// Use with bracketDisposable
const withTempFile = bracketDisposable({
  acquire: async () => new TempFile('/tmp/data.tmp'),
  use: processTempFile,
  merge: (ctx, file) => ({ ...ctx, tempFile: file })
});
```

### Future Compatibility

When the `using` statement becomes available:

```typescript
// Future JavaScript (when proposal is implemented)
{
  using file = new TempFile('/tmp/data.tmp');
  await processFile(file);
} // Automatically disposed here

// Today with bracket
await run(
  bracketDisposable({
    acquire: async () => new TempFile('/tmp/data.tmp'),
    use: processFile,
    merge: (ctx, file) => ({ ...ctx, file })
  }),
  undefined
);
```

## Best Practices

### 1. Keep Resources Minimal

Only include what's needed in the merged context:

```typescript
// Good - only exposes query method
merge: (ctx, conn) => ({ 
  ...ctx, 
  query: conn.query.bind(conn) 
})

// Avoid - exposes entire connection
merge: (ctx, conn) => ({ 
  ...ctx, 
  dbConnection: conn 
})
```

### 2. Handle Release Errors Gracefully

```typescript
release: defineTask(async (resource) => {
  try {
    await resource.close();
  } catch (error) {
    // Log but continue - don't mask the original error
    console.error('Cleanup failed:', error);
  }
})
```

### 3. Use Type-Safe Context Extensions

```typescript
interface DbContext extends AppContext {
  db: Database;
}

const withDb = bracket<AppContext, Database, string, User>({
  acquire: getDatabase,
  use: defineTask<DbContext, string, User>(async (userId) => {
    const { db } = getContext<DbContext>();
    return db.findUser(userId);
  }),
  release: closeDatabase,
  merge: (ctx, db): DbContext => ({ ...ctx, db })
});
```

### 4. Compose Resources Thoughtfully

```typescript
// Acquire resources in dependency order
const withFullStack = bracketMany([
  { acquire: getDb, release: closeDb, merge: addDb },
  { acquire: getCache, release: closeCache, merge: addCache },
  { acquire: getQueue, release: closeQueue, merge: addQueue }
], appWorkflow);
// Releases in reverse: queue -> cache -> db
```

## Examples

### Transaction Management

```typescript
const withTransaction = bracket({
  acquire: defineTask(async () => {
    const { db } = getContext();
    const tx = await db.beginTransaction();
    return { tx, committed: false };
  }),
  
  use: defineTask(async (data: UpdateData) => {
    const { tx } = getContext();
    await tx.query('UPDATE users SET ...', data);
    await tx.query('INSERT INTO audit_log ...', data);
    return { success: true };
  }),
  
  release: defineTask(async ({ tx, committed }) => {
    if (!committed) {
      await tx.rollback();
    }
  }),
  
  merge: (ctx, { tx }) => ({ ...ctx, tx })
});
```

### HTTP Request with Timeout

```typescript
const withTimeout = bracket({
  acquire: defineTask(async (ms: number) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ms);
    return { controller, timeout };
  }),
  
  use: defineTask(async (url: string) => {
    const { controller } = getContext();
    const response = await fetch(url, { 
      signal: controller.signal 
    });
    return response.json();
  }),
  
  release: defineTask(async ({ timeout }) => {
    clearTimeout(timeout);
  }),
  
  merge: (ctx, { controller }) => ({ ...ctx, controller })
});
```

### Distributed Lock

```typescript
const withDistributedLock = bracket({
  acquire: defineTask(async (lockKey: string) => {
    const { redis } = getContext();
    const lockId = crypto.randomUUID();
    const acquired = await redis.set(
      lockKey, 
      lockId, 
      'NX', 
      'EX', 
      30
    );
    if (!acquired) throw new Error('Lock unavailable');
    return { lockKey, lockId };
  }),
  
  use: criticalSection,
  
  release: defineTask(async ({ lockKey, lockId }) => {
    const { redis } = getContext();
    // Only release if we still own the lock
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redis.eval(script, 1, lockKey, lockId);
  }),
  
  merge: (ctx, lock) => ({ ...ctx, lock })
});
```

### Metrics Collection

```typescript
const withMetrics = bracket({
  acquire: defineTask(async (operation: string) => {
    const startTime = Date.now();
    return { operation, startTime };
  }),
  
  use: actualOperation,
  
  release: defineTask(async ({ operation, startTime }) => {
    const { metrics } = getContext();
    const duration = Date.now() - startTime;
    metrics.recordDuration(operation, duration);
  }),
  
  merge: (ctx, _) => ctx // No context change needed
});
```

## Conclusion

The bracket pattern provides a robust, composable approach to resource management in async workflows. By explicitly separating acquisition, usage, and cleanup phases, it ensures resources are properly managed even in complex scenarios with multiple resources, nested operations, and error conditions.

The integration with the TC39 Explicit Resource Management proposal ensures your code is ready for future JavaScript features while providing immediate benefits today.