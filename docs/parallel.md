# Effectively Parallel - Concurrent Task Execution

## Overview

The `parallel` module provides advanced concurrent task execution for Effectively workflows.It leverages the browser's native Scheduler API when available (as described in the W3C Scheduling APIs proposal) and falls back to Promise-based scheduling for broader compatibility.

## Key Features

  - ** Native Scheduler Integration **: Automatically uses `scheduler.postTask()` when available
    - ** Controlled Concurrency **: Limit the number of tasks running simultaneously
      - ** Priority - based Scheduling **: Leverage browser task priorities for better performance
        - ** Batching Support **: Group tasks for efficient execution
          - ** Cancellation Support **: Full integration with AbortSignal
          - ** Flexible Result Handling **: Choose between preserving order or getting results as they complete

## Basic Usage

### Simple Parallel Execution

  ```typescript
import { parallel, defineTask } from 'effectively';

const fetchUser = defineTask(async (id: string) => {
  const response = await fetch(`/ api / users / ${ id } `);
  return response.json();
});

const fetchPosts = defineTask(async (userId: string) => {
  const response = await fetch(`/ api / users / ${ userId }/posts`);
return response.json();
});

const fetchComments = defineTask(async (userId: string) => {
  const response = await fetch(`/api/users/${userId}/comments`);
  return response.json();
});

// Execute all tasks in parallel
const results = await run(
  defineTask(async (userId: string) => {
    return parallel(
      [fetchUser, fetchPosts, fetchComments],
      userId
    );
  }),
  'user-123'
);
```

### With Concurrency Control

```typescript
// Limit to 2 concurrent requests
const results = await parallel(
  [task1, task2, task3, task4, task5],
  inputValue,
  { concurrency: 2 }
);
```

## API Reference

### `parallel<C, V, R>(tasks, value, options ?): Promise<ParallelResult<R>[]>`

Execute multiple tasks in parallel with controlled concurrency.

#### Parameters

- `tasks: ReadonlyArray<Task<C, V, R>>` - Array of tasks to execute
- `value: V` - Input value passed to each task
- `options ?: ParallelOptions` - Configuration options

#### Options

```typescript
interface ParallelOptions {
  concurrency?: number;        // Max concurrent tasks (default: Infinity)
  priority?: TaskPriority;     // 'user-blocking' | 'user-visible' | 'background'
  batching?: boolean;          // Enable batch scheduling (default: false)
  batchSize?: number;          // Size of batches (default: 10)
  preserveOrder?: boolean;     // Preserve task order in results (default: true)
  signal?: AbortSignal;        // Custom abort signal
}
```

#### Returns

Array of `ParallelResult<R>` objects:

```typescript
type ParallelResult<T> =
  | { status: 'fulfilled'; value: T; index: number }
  | { status: 'rejected'; reason: unknown; index: number };
```

### Helper Functions

#### `parallelAll<C, V, R>(tasks, value, options ?): Promise<R[]>`

Like `Promise.all` - throws if any task fails:

```typescript
try {
  const [user, posts, comments] = await parallelAll(
    [fetchUser, fetchPosts, fetchComments],
    userId
  );
} catch (error) {
  // Handle any failure
}
```

#### `parallelSettled<C, V, R>(tasks, value, options ?): Promise<R[]>`

Returns only successful results, filtering out failures:

```typescript
const successfulResults = await parallelSettled(
  [task1, task2, task3],
  value
);
// Only contains results from tasks that succeeded
```

#### `race<C, V, R>(tasks, value, options ?): Promise<R>`

Returns the first task to complete (success or failure):

```typescript
const fastest = await race(
  [primaryServer, fallbackServer],
  request
);
```

#### `parallelTask<C, V, R>(tasks, options ?): Task<C, V, ParallelResult<R>[]>`

Creates a reusable parallel task:

```typescript
const fetchAllUserData = parallelTask(
  [fetchProfile, fetchSettings, fetchPreferences],
  { priority: 'user-blocking' }
);

// Use in a workflow
const workflow = pipe(
  validateUserId,
  fetchAllUserData,
  processUserData
);
```

## Scheduler Integration

### Browser Scheduler API

When available, the module uses the native `scheduler.postTask()` API:

```typescript
// With native scheduler
scheduler.postTask(() => doWork(), {
  priority: 'user-visible',
  signal: abortSignal
});
```

### Fallback Behavior

When the native scheduler isn't available:
- `user - blocking` priority uses microtasks (`queueMicrotask`)
- Other priorities use macrotasks (`setTimeout`)
- Priority-based delays are applied

### Custom Scheduler

You can check if the native scheduler is being used:

```typescript
import { scheduler } from 'effectively/parallel';

if (scheduler.isNative) {
  console.log('Using native browser scheduler');
} else {
  console.log('Using fallback scheduler');
}
```

## Advanced Patterns

### Batched Execution

Process tasks in groups for better performance:

```typescript
// Process 100 tasks in batches of 10
const results = await parallel(
  tasks,
  input,
  {
    batching: true,
    batchSize: 10,
    priority: 'background'
  }
);
```

### Dynamic Concurrency

Adjust concurrency based on conditions:

```typescript
const concurrency = navigator.connection?.effectiveType === '4g' ? 5 : 2;

const results = await parallel(
  downloadTasks,
  urls,
  { concurrency }
);
```

### Priority-based Loading

```typescript
// Critical resources with high priority
const criticalData = await parallel(
  [fetchUserData, fetchAppConfig],
  null,
  { priority: 'user-blocking' }
);

// Then load secondary data
const secondaryData = await parallel(
  [fetchRecommendations, fetchAds],
  userId,
  { priority: 'background' }
);
```

### Streaming Results

Get results as they complete rather than waiting for all:

```typescript
const results = await parallel(
  slowTasks,
  input,
  { preserveOrder: false }
);

// Results arrive in completion order, not task order
for (const result of results) {
  if (result.status === 'fulfilled') {
    updateUI(result.value);
  }
}
```

### Error Recovery

```typescript
const results = await parallel(tasks, input);

const successful = results.filter(r => r.status === 'fulfilled');
const failed = results.filter(r => r.status === 'rejected');

if (failed.length > 0) {
  // Retry failed tasks
  const retryResults = await parallel(
    failed.map(f => tasks[f.index]),
    input,
    { concurrency: 1 } // Retry one at a time
  );
}
```

## Integration with Bracket

Combine parallel execution with resource management:

```typescript
const withConnections = bracket({
  acquire: async () => {
    // Acquire multiple connections in parallel
    const results = await parallel(
      [connectDb1, connectDb2, connectCache],
      config
    );
    return results.map(r => r.status === 'fulfilled' ? r.value : null);
  },

  use: async () => {
    // Use connections for parallel queries
    return parallel(
      [queryDb1, queryDb2, queryCache],
      query,
      { concurrency: 2 }
    );
  },

  release: async (connections) => {
    // Close all connections in parallel
    await parallelSettled(
      connections.map(conn => defineTask(async () => conn?.close())),
      null
    );
  },

  merge: (ctx, connections) => ({ ...ctx, connections })
});
```

## Performance Considerations

### Concurrency Limits

- **CPU-bound tasks**: Use `navigator.hardwareConcurrency` as a guide
- **I/O-bound tasks**: Can handle higher concurrency (10-20)
- **API requests**: Respect rate limits and browser connection limits

### Priority Guidelines

- **`user - blocking`**: User input handlers, critical UI updates
- **`user - visible`**: Animations, visible content updates
- **`background`**: Analytics, prefetching, non-critical updates

### Batching Benefits

Batching is beneficial when:
- Tasks have setup/teardown overhead
- You want to reduce scheduler pressure
- Tasks can share resources within a batch

## Browser Compatibility

The module provides automatic feature detection and fallbacks:

| Feature | Native Support | Fallback |
|---------|---------------|----------|
| scheduler.postTask | Chrome 94+ | setTimeout/queueMicrotask |
| AbortSignal | All modern browsers | Required |
| Promise.allSettled | All modern browsers | Required |

## Examples

### Data Aggregation Dashboard

```typescript
const loadDashboard = pipe(
  // First, load user preferences
  loadUserPreferences,

  // Then fetch all widgets in parallel
  defineTask(async (prefs: UserPrefs) => {
    const widgetTasks = prefs.widgets.map(w =>
      defineTask(async () => fetchWidget(w.id))
    );

    return parallelAll(widgetTasks, null, {
      concurrency: 4,
      priority: 'user-visible'
    });
  }),

  // Render dashboard with all widget data
  renderDashboard
);
```

### Progressive Image Loading

```typescript
const loadImages = defineTask(async (imageUrls: string[]) => {
  // Load critical above-the-fold images first
  const critical = imageUrls.slice(0, 3);
  const remaining = imageUrls.slice(3);

  const criticalResults = await parallel(
    critical.map(url => defineTask(() => loadImage(url))),
    null,
    { priority: 'user-blocking' }
  );

  // Load remaining images in background
  const remainingResults = await parallel(
    remaining.map(url => defineTask(() => loadImage(url))),
    null,
    {
      priority: 'background',
      concurrency: 2,
      preserveOrder: false
    }
  );

  return [...criticalResults, ...remainingResults];
});
```

### API Request Coordination

```typescript
const searchEverywhere = defineTask(async (query: string) => {
  const searchTasks = [
    searchUsers,
    searchPosts,
    searchComments,
    searchTags
  ];

  // Race to show first results quickly
  const firstResult = await race(searchTasks, query);
  showQuickResult(firstResult);

  // Continue loading all results
  const allResults = await parallelSettled(searchTasks, query);
  showCompleteResults(allResults);
});
```

## Best Practices

1. **Choose appropriate concurrency limits** based on task type and device capabilities
2. **Use priorities** to ensure critical work completes first
3. **Handle partial failures** gracefully with `parallelSettled`
4. **Consider batching** for many small tasks
5. **Monitor performance** and adjust concurrency dynamically
6. **Respect browser limits** for network connections (typically 6-8 per domain)
7. **Use cancellation** to stop unnecessary work early