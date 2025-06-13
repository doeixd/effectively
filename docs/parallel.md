## 🚀 Running Tasks in Parallel: A Comprehensive Guide

Modern applications often need to perform multiple operations concurrently to improve responsiveness and efficiency. This guide explores how to leverage the parallel execution capabilities within the "Effectively" library to manage complex asynchronous workflows. We'll cover everything from simple parallel calls to advanced streaming and scheduling techniques.

### Table of Contents

1.  [Why Run Tasks in Parallel?](#why-run-tasks-in-parallel)
2.  [Getting Started: Simple Parallel Execution](#getting-started-simple-parallel-execution)
    *   [`allSettled`: Capturing All Outcomes](#allsettled-capturing-all-outcomes)
    *   [`all`: Fail-Fast Parallel Execution (Like `Promise.all`)](#all-fail-fast-parallel-execution-like-promiseall)
3.  [Controlling Parallelism: `ParallelOptions`](#controlling-parallelism-paralleloptions)
    *   `concurrency`: Limiting Simultaneous Tasks
    *   `priority`: Guiding the Scheduler
    *   `batching` & `batchSize`: Processing in Groups
    *   `preserveOrder`: Result Order vs. Completion Order
    *   `signal`: Custom Cancellation
4.  [Structured Parallelism: `forkJoin` and `allTuple`](#structured-parallelism-forkjoin-and-alltuple)
    *   `forkJoin`: Named Parallel Tasks
    *   `allTuple`: Ordered Parallel Tasks with Typed Tuples
    *   "Settled" Variants: `forkJoinSettled` and `allTupleSettled`
5.  [Advanced Result Handling](#advanced-result-handling)
    *   `some`: Collecting Only Successful Results
    *   `race`: Getting the First Task to Settle
    *   `any`: Getting the First Task to Succeed
6.  [Streaming Parallelism: Handling Large or Dynamic Task Sets](#streaming-parallelism-handling-large-or-dynamic-task-sets)
    *   `stream`: Core Streaming Engine
    *   `streamAll`, `streamSome`, `streamAny`, `raceFrom` (for Iterables)
7.  [Conditional Parallelism with `ift`](#conditional-parallelism-with-ift)
8.  [The Scheduler Backend](#the-scheduler-backend)
    *   Native Scheduler vs. Promise-Based Fallback
    *   Using `scheduler.postTask` Directly
9.  [Best Practices & Performance Considerations](#best-practices--performance-considerations)
10. [Troubleshooting Common Issues](#troubleshooting-common-issues)

---

### 1. Why Run Tasks in Parallel?

Many applications involve operations that can happen independently without waiting for each other. For example:

*   Fetching user profile data, user settings, and user activity simultaneously for a dashboard.
*   Processing multiple uploaded files.
*   Making several API calls to different microservices.

Running these tasks in parallel, rather than one after another (sequentially), can dramatically reduce the total time taken, leading to faster load times and a more responsive user experience.

---

### 2. Getting Started: Simple Parallel Execution

The "Effectively" library provides several utilities to run an array of tasks concurrently. All these utilities expect an array of `Task<C, V, R>` functions and a common input value `V` that will be passed to each task.

#### `allSettled`: Capturing All Outcomes

This is often the most robust starting point. `allSettled` executes all provided tasks in parallel and waits for *all of them to complete*, regardless of whether they succeed or fail. It *never rejects* its own promise (unless there's an unexpected internal error). Instead, it resolves with an array detailing the outcome of each individual task.

**API:** `allSettled<C, V, R>(tasks, value, options?, providedContext?): Promise<ParallelResult<R>[]>`

*   `tasks: ReadonlyArray<Task<C, V, R>>`: An array of your tasks.
*   `value: V`: The common input value passed to each task.
*   `options?: ParallelOptions`: Optional configuration (see [Controlling Parallelism](#controlling-parallelism-paralleloptions)).
*   `providedContext?: C`: Optional explicit context. Defaults to ambient context.

**`ParallelResult<R>` Structure:**

Each element in the resolved array will be an object:

*   `{ status: 'fulfilled'; value: R; index: number }` if the task succeeded.
*   `{ status: 'rejected'; reason: unknown; index: number }` if the task failed.
    *   `index` refers to the original position of the task in the input `tasks` array, especially useful when `preserveOrder: false`.

**Example:**

```typescript
import { allSettled, defineTask, run, createContext, type BaseContext } from 'effectively'; // Adjust path

interface MyContext extends BaseContext { /* ... */ }
const { run: appRun, defineTask: appDefineTask } = createContext<MyContext>({ /* ... */ });

const fetchUserData = appDefineTask(async (ctx, userId: string) => {
  console.log(`Fetching user ${userId}`);
  // Simulate API call
  await new Promise(res => setTimeout(res, 100));
  if (userId === 'user-error') throw new Error('Failed to fetch user');
  return { id: userId, name: `User ${userId}` };
});

const fetchUserOrders = appDefineTask(async (ctx, userId: string) => {
  console.log(`Fetching orders for ${userId}`);
  await new Promise(res => setTimeout(res, 150));
  return [{ orderId: 'o1', amount: 100 }, { orderId: 'o2', amount: 50 }];
});

const loadAllData = appDefineTask(async (ctx, userId: string) => {
  const results = await allSettled(
    [fetchUserData, fetchUserOrders], // Array of Tasks
    userId,                          // Common input value for both tasks
    { concurrency: 2 }               // Options
    // `ctx` is implicitly passed if appDefineTask is used from the same ContextTools as run
  );

  const userData = results[0].status === 'fulfilled' ? results[0].value : null;
  const ordersData = results[1].status === 'fulfilled' ? results[1].value : [];

  if (results[0].status === 'rejected') {
    console.error('User fetch failed:', results[0].reason);
  }

  return { user: userData, orders: ordersData };
});

async function main() {
  let data = await appRun(loadAllData, 'user-123');
  console.log('Data for user-123:', data);

  data = await appRun(loadAllData, 'user-error'); // This will show one failure
  console.log('Data for user-error:', data);
}

main();
```

**When to use `allSettled`:**

*   When you need to know the outcome of every task, even if some fail.
*   When one task failing shouldn't necessarily stop others or fail the overall operation.
*   Ideal for dashboards where you want to display as much data as possible, showing errors for parts that failed.

---

#### `all`: Fail-Fast Parallel Execution (Like `Promise.all`)

If you need all tasks to succeed and want the entire operation to fail if *any single task* fails, use `all`. This behaves like the standard `Promise.all`.

**API:** `all<C, V, R>(tasks, value, options?, providedContext?): Promise<R[]>`

*   Returns a `Promise` that resolves to an array of results `R[]` if all tasks succeed. The order of results matches the input `tasks` array.
*   If any task rejects, the promise returned by `all` immediately rejects with the reason of the first task that failed. Other tasks might still be running but their results/errors will be ignored.

**Example:**

```typescript
import { all, defineTask, run, createContext, type BaseContext } from 'effectively';

// Assuming fetchCriticalConfig and fetchEssentialService are defined Tasks
// const fetchCriticalConfig = appDefineTask(async (ctx, serviceName: string) => { /* ... */ });
// const fetchEssentialService = appDefineTask(async (ctx, serviceName: string) => { /* ... */ });

const initializeApp = appDefineTask(async (ctx, appName: string) => {
  try {
    // Both results are needed, so use `all`
    const [config, serviceStatus] = await all(
      [fetchCriticalConfig, fetchEssentialService],
      appName, // Common input (e.g., appName or null if tasks don't need it)
      { priority: 'user-blocking' }
    );
    // Both `config` and `serviceStatus` are available here if successful
    return { config, serviceStatus };
  } catch (error) {
    console.error(`Critical initialization failed for ${appName}:`, error);
    throw error; // Re-throw to fail the `initializeApp` task
  }
});

// async function main() {
//   try {
//     const initResult = await appRun(initializeApp, "my-app");
//     console.log("App initialized:", initResult);
//   } catch (e) {
//     console.log("App failed to initialize fully.");
//   }
// }
// main();
```

**When to use `all`:**

*   When all parallel operations are critical, and the failure of one means the overall operation cannot succeed.
*   When you want behavior identical to `Promise.all` but with the added benefits of the "Effectively" scheduler (priority, concurrency, cancellation).

---

### 3. Controlling Parallelism: `ParallelOptions`

All array-based parallel utilities (`allSettled`, `all`, `some`, `any`) accept an optional `options` object of type `ParallelOptions`:

```typescript
export interface ParallelOptions {
  concurrency?: number;        // Default: Infinity
  priority?: TaskPriority;     // Default: 'user-visible' ('user-blocking' | 'user-visible' | 'background')
  batching?: boolean;          // Default: false
  batchSize?: number;          // Default: 10 (only if batching is true)
  preserveOrder?: boolean;     // Default: true (for allSettled, results match input task order)
  signal?: AbortSignal;        // Default: context.scope.signal (for overall cancellation)
}
```

*   **`concurrency: number`**
    *   Limits how many tasks run simultaneously. For example, `{ concurrency: 5 }` will run at most 5 tasks at a time.
    *   Crucial for I/O-bound tasks (like network requests) to avoid overwhelming the browser, server, or rate limits.
    *   For CPU-bound tasks, setting concurrency close to `navigator.hardwareConcurrency` can be optimal.
    *   If `batching` is true, `concurrency` is typically not applied directly by `executeBatched` (batches run sequentially, parallelism is *within* a batch via `scheduler.postTask` which respects priority).

*   **`priority: TaskPriority`**
    *   Guides the underlying scheduler (`scheduler.postTask`).
    *   `'user-blocking'`: Highest priority (e.g., use `queueMicrotask` in fallback). For critical UI updates, input responses.
    *   `'user-visible'`: Default. For tasks that update visible content but aren't immediately blocking.
    *   `'background'`: Lowest priority. For deferrable work like logging, analytics, pre-fetching.
    *   The native browser scheduler uses these hints for better resource allocation. The fallback scheduler approximates this.

*   **`batching: boolean` and `batchSize: number`**
    *   When `batching: true`, tasks are grouped into batches of `batchSize`.
    *   Batches are processed sequentially. Tasks *within* each batch are posted to the scheduler and can run in parallel according to their priority and available resources.
    *   Useful when there's an overhead per "operation dispatch" or if tasks within a batch can share resources or context more efficiently.
    *   When `batching` is true, the `concurrency` option in `ParallelOptions` is not directly used by the `executeBatched` strategy; concurrency is managed at the `scheduler.postTask` level for tasks within a batch.

*   **`preserveOrder: boolean`** (Mainly for `allSettled`, `any`)
    *   If `true` (default for `allSettled`), the array of `ParallelResult` objects will be in the same order as the input `tasks` array. Each `ParallelResult` includes an `index` property corresponding to its original position.
    *   If `false`, results may arrive in completion order, which can be slightly more performant if you don't need the original order and process results as they come.
    *   `all` always preserves order implicitly. `some` effectively uses `preserveOrder: false`.

*   **`signal: AbortSignal`**
    *   Allows you to provide a custom `AbortSignal` to cancel the entire parallel operation.
    *   If not provided, it defaults to `context.scope.signal` from the context in which the parallel utility is run.
    *   The scheduler utilities also listen to `context.scope.signal` and will aggregate it with this provided signal.

---

### 4. Structured Parallelism: `forkJoin` and `allTuple`

These are **pipeable operators**, usually used within `createWorkflow` (from `@doeixd/effectively/utils`) or with a `pipe` function, to manage parallel tasks whose results contribute to a structured output.

#### `forkJoin`: Named Parallel Tasks

Executes an *object* of tasks in parallel, where each key in the object maps to a task. The result is an object with the same keys, but with the resolved values of the tasks.

**API:** `forkJoin<C, V, T extends Record<string, Task<C, V, any>>>(tasks: T): Task<C, V, { [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }>`

**Example:**

```typescript
import { forkJoin /*, createWorkflow, fromValue, map (from utils) */ } from 'effectively'; // utils & parallel
// Assuming:
// const fetchUser = appDefineTask(async (ctx, userId: string) => ({ id: userId, name: 'Alice' }));
// const fetchUserPreferences = appDefineTask(async (ctx, userId: string) => ({ theme: 'dark' }));

const getUserDashboardData = createWorkflow(
  fromValue('user-123'), // Input: userId
  forkJoin({
    profile: fetchUser,         // profile will be User object
    settings: fetchUserPreferences // settings will be Prefs object
  }),
  // Output of forkJoin: { profile: User, settings: Prefs }
  map(dashboardData => {
    return `User: ${dashboardData.profile.name}, Theme: ${dashboardData.settings.theme}`;
  })
);

// const dashboardMessage = await appRun(getUserDashboardData, undefined);
// console.log(dashboardMessage); // "User: Alice, Theme: dark"
```

*   `forkJoin` uses `Promise.all` semantics (fail-fast).

#### `allTuple`: Ordered Parallel Tasks with Typed Tuples

Executes an *array (or tuple)* of tasks in parallel and returns their results in a typed tuple. For best type inference, use `as const` with your input task array.

**API:** `allTuple<C, V, T extends ReadonlyArray<Task<C, V, any>>>(tasks: T): Task<C, V, { -readonly [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }>`

**Example:**

```typescript
import { allTuple /*, createWorkflow, fromValue (from utils) */ } from 'effectively';
// Assuming:
// const dbConnect = appDefineTask(async (ctx, _:null) => ({ type: 'db' as const }));
// const cacheConnect = appDefineTask(async (ctx, _:null) => ({ type: 'cache' as const }));

const initializeServices = createWorkflow(
  fromValue(null), // No specific input needed for these connection tasks
  allTuple([
    dbConnect,
    cacheConnect
  ] as const), // `as const` is crucial for tuple type inference!
  // Output: [DbConnection, CacheClient]
  map(([db, cache]) => { // Destructure with types!
    console.log('DB Type:', db.type);
    console.log('Cache Type:', cache.type);
    return 'Services initialized';
  })
);

// const initStatus = await appRun(initializeServices, undefined);
// console.log(initStatus);
```

*   `allTuple` also uses `Promise.all` semantics (fail-fast).

#### "Settled" Variants: `forkJoinSettled` and `allTupleSettled`

Just like `allSettled` for arrays, these variants execute all tasks and return their outcomes (success or failure) without the main task rejecting.

*   **`forkJoinSettled`**: Returns `Task<..., { [K in keyof T]: SettledTaskResult<R> }>`
*   **`allTupleSettled`**: Returns `Task<..., { -readonly [K in keyof T]: SettledTaskResult<R> }>`

   Where `SettledTaskResult<R>` is `Result<R, unknown>` from `neverthrow`.

**Example (`forkJoinSettled`):**

```typescript
import { forkJoinSettled, type SettledTaskResult /*, ... */ } from 'effectively';

// Assuming fetchPrimaryData might fail, fetchSecondaryData is more reliable
const fetchCombinedData = createWorkflow(
  fromValue('input'),
  forkJoinSettled({
    primary: fetchPrimaryData,   // Task<Ctx, string, PrimaryData>
    secondary: fetchSecondaryData // Task<Ctx, string, SecondaryData>
  }),
  map(results => {
    const primary = results.primary.isOk() ? results.primary.value : null;
    if (results.primary.isErr()) {
      console.warn("Primary data failed to load:", results.primary.error);
    }
    const secondary = results.secondary.unwrapOr({ default: true }); // Use neverthrow's unwrapOr

    return { primary, secondary };
  })
);
```

---

### 5. Advanced Result Handling

Beyond `all` and `allSettled`, this module provides helpers mirroring other `Promise` combinators:

*   **`some<C, V, R>(tasks, value, options?, ctx?): Promise<R[]>`**
    *   Executes all tasks in parallel.
    *   Resolves with an array containing only the values from successfully fulfilled tasks.
    *   Rejections are ignored. The order of results is based on completion.
    *   Useful when you want any available data and failures are acceptable for individual items.

*   **`race<C, V, R>(tasks, value, options?, ctx?): Promise<R>`**
    *   Like `Promise.race`. Resolves or rejects with the outcome (value or reason) of the *first task to settle* (either fulfill or reject).
    *   Other tasks are signalled to cancel (via the internal `raceController`).
    *   `options` exclude `preserveOrder` and `batching`.

*   **`any<C, V, R>(tasks, value, options?, ctx?): Promise<R>`**
    *   Like `Promise.any`. Resolves with the value of the *first task to fulfill*.
    *   If all tasks reject, it rejects with an `AggregateError` containing all rejection reasons.
    *   The "first" successful task is determined by iterating through the `allSettled` results (order depends on `preserveOrder` in `options`). For temporally first, see `streamAny`.

---

### 6. Streaming Parallelism: Handling Large or Dynamic Task Sets

When dealing with a very large number of tasks, or when tasks are generated dynamically (e.g., from a paginated API), loading them all into an array for `allSettled` can be memory-intensive. Streaming utilities process tasks from an `Iterable` or `AsyncIterable`, yielding results as they complete with controlled concurrency.

**Options:** `Omit<ParallelOptions, 'preserveOrder' | 'batching'>` (these don't apply to unordered streams).

*   **`stream<C, V, R>(tasksIterable, value, options?, ctx?): AsyncIterable<ParallelResult<R>>`**
    *   The core streaming engine. Takes an iterable of tasks.
    *   Executes tasks with specified `concurrency` and `priority`.
    *   Yields `ParallelResult<R>` objects (like `allSettled`) as each task completes.
    *   Highly memory efficient.

**Example (`stream`):**

```typescript
import { stream, defineTask, run, createContext, type BaseContext } from 'effectively';

// async function* generateTasks(count: number, inputValue: string): AsyncIterable<Task<MyContext, string, string>> {
//   for (let i = 0; i < count; i++) {
//     await new Promise(r => setTimeout(r, 10)); // Simulate dynamic task generation
//     yield appDefineTask(async (ctx, val: string) => {
//       await new Promise(r => setTimeout(r, Math.random() * 100));
//       return `Result from ${val} - task ${i}`;
//     });
//   }
// }

// const processStreamedResults = appDefineTask(async (ctx, { count, inputValue }) => {
//   const taskIterable = generateTasks(count, inputValue);
//   let successful = 0;
//   for await (const result of stream(taskIterable, inputValue, { concurrency: 3 }, ctx)) {
//     if (result.status === 'fulfilled') {
//       console.log('Streamed result:', result.value);
//       successful++;
//     } else {
//       console.error('Streamed task failed:', result.reason);
//     }
//   }
//   return `Processed ${count} tasks, ${successful} succeeded.`;
// });

// await appRun(processStreamedResults, { count: 100, inputValue: 'stream-input' });
```

**Derived Streaming Helpers:**

*   **`streamAll<C, V, R>(...): AsyncIterable<R>`**: Yields successful results; throws on the first task failure (fail-fast).
*   **`streamSome<C, V, R>(...): AsyncIterable<R>`**: Yields successful results; ignores task failures.
*   **`streamAny<C, V, R>(...): Promise<R>`**: Resolves with the value of the *temporally first* task to fulfill from the iterable; rejects with `AggregateError` if all fail.
*   **`raceFrom<C, V, R>(...): Promise<R>`**: Resolves/rejects with the outcome of the *temporally first* task to settle from the iterable.

---

### 7. Conditional Parallelism with `ift`

While not strictly a parallel execution utility itself, `ift` (if-then-else) is a crucial control flow operator from `parallel-utils.ts` (or your control flow module) that can determine *which* parallel (or sequential) workflow to execute.

**API:** `ift<C, V, R1, R2>(predicate, onTrueTask, onFalseTask): Task<C, V, R1 | R2>`

**Example:**

```typescript
// import { ift, all, fromValue, createWorkflow } from 'effectively';

// const complexProcessing = appDefineTask(async (ctx, data) => { /* ... */ return "complex"; });
// const simpleProcessing = appDefineTask(async (ctx, data) => { /* ... */ return "simple"; });
// const routeData = appDefineTask(async (ctx, initialData) => {
//   return createWorkflow(
//     fromValue(initialData),
//     ift(
//       (data) => data.isComplex, // Predicate
//       complexProcessing,        // Task to run if true
//       simpleProcessing         // Task to run if false
//     )
//   )(ctx, initialData); // Immediately invoke the created workflow task
// });

// const result = await appRun(routeData, { isComplex: true, payload: "..." }); // result is "complex"
```

---

### 8. The Scheduler Backend

This module features a sophisticated scheduler that:

1.  **Detects Native Support:** Checks for `globalThis.scheduler.postTask` (from the W3C Scheduling APIs proposal).
2.  **Uses Native Scheduler:** If available, tasks are posted using the browser's own optimized scheduler, respecting priorities like `'user-blocking'`, `'user-visible'`, and `'background'`.
3.  **Provides Fallback:** If the native API is absent (e.g., older browsers, some Node.js versions without specific flags/polyfills):
    *   `'user-blocking'` tasks are scheduled via `queueMicrotask` for immediate execution after the current task.
    *   `'user-visible'` tasks are scheduled via `setTimeout(fn, 0)`.
    *   `'background'` tasks are scheduled via `setTimeout(fn, 4)` (or a slightly higher configurable delay) to yield to more critical work.
4.  **Handles Cancellation:** All tasks posted via `scheduler.postTask` (both native and fallback) respect `AbortSignal`s.

You can inspect which scheduler is active:

```typescript
import { scheduler } from 'effectively'; // Assuming scheduler is exported from the main parallel module

if (scheduler.isNative) {
  console.log('Using native environment scheduler.');
} else {
  console.log('Using Promise-based fallback scheduler.');
}
```

You can also use `scheduler.postTask` directly for custom, low-level scheduling needs if the higher-level utilities don't fit your exact use case.

---

### 9. Best Practices & Performance Considerations

*   **Concurrency Limits:**
    *   For **CPU-bound** tasks (heavy calculations), set `concurrency` around `navigator.hardwareConcurrency` (if available) or a small number (e.g., 2-4) to avoid thrashing.
    *   For **I/O-bound** tasks (network requests, file system operations), you can often use higher concurrency (e.g., 5-10, or even more for many fast API calls), but be mindful of:
        *   Browser connection limits per domain (typically 6-8).
        *   Server rate limits.
        *   Database connection pool sizes.
*   **Task Priority:**
    *   Use `'user-blocking'` sparingly for only the most critical operations needed for immediate UI responsiveness.
    *   `'user-visible'` is a good default for most work that affects what the user sees.
    *   `'background'` is excellent for deferring non-critical work (analytics, logging, pre-fetching offscreen data).
*   **Batching:**
    *   Consider `batching: true` if:
        *   You have many small, quick tasks where the overhead of scheduling each individually is significant.
        *   There's a setup/teardown cost per group of operations (e.g., opening/closing a connection for a batch).
        *   The underlying API you're calling supports batch requests (e.g., `GET /users?ids=1,2,3`).
*   **`preserveOrder: false` for `allSettled` / `some`:** If you are processing results as they come in and don't need them in the original task order, setting `preserveOrder: false` can sometimes allow for slightly faster processing of the first available results.
*   **Streaming (`stream` and variants):** For very large datasets or when tasks are generated dynamically, streaming utilities are vastly more memory-efficient than array-based ones as they don't require all tasks or all results to be in memory at once.
*   **Error Handling Choice:**
    *   Use `all` / `forkJoin` / `allTuple` / `streamAll` (fail-fast) when all parallel operations must succeed.
    *   Use `allSettled` / `forkJoinSettled` / `allTupleSettled` / `stream` (settled) when you need to handle individual successes and failures and the overall operation should proceed.
*   **Cancellation:** Ensure your individual `Task` implementations respect their `context.scope.signal` to make them truly cancellable, allowing the parallel utilities to terminate work early.

---

### 10. Troubleshooting Common Issues

*   **Tasks Not Running in Parallel / Slow Performance:**
    *   Check `concurrency` option. If it's too low (e.g., 1), tasks will run sequentially.
    *   Ensure your tasks are truly asynchronous (`async` functions that `await` I/O or use `scheduler.postTask` for CPU work). A long-running synchronous task will block one of your concurrency "slots."
    *   Browser DevTools (Performance tab) can help identify bottlenecks.

*   **"Too many requests" / Rate Limiting / Server Errors:**
    *   Reduce the `concurrency` for I/O-bound tasks.
    *   Implement exponential backoff and retry logic *within* your individual tasks (e.g., using `withRetry` from `@doeixd/effectively/utils`) if appropriate, or at a higher level around the parallel call.

*   **`AggregateError` when using `any` or `streamAny`:**
    *   This is expected if *all* tasks provided to `any` or `streamAny` reject. Inspect the `errors` property of the `AggregateError` to see individual rejection reasons.

*   **Incorrect Result Order:**
    *   If using `allSettled`, ensure `preserveOrder` is `true` (default) if you rely on result order matching input task order.
    *   `some` and streaming utilities (by default, as they yield on completion) do not guarantee input order.

*   **Cancellation Not Working:**
    *   Verify the `AbortSignal` (either from `context.scope.signal` or passed in `options.signal`) is actually being aborted when expected.
    *   Ensure your individual `Task` implementations check `context.scope.signal.aborted` at appropriate points, especially within loops or before expensive operations. The scheduler will stop *posting new tasks* on abort, but already running tasks need to self-terminate.

*   **`getContext()` Issues in Tasks:**
    *   If tasks run by the scheduler use the global `getContext()`, ensure the `run` call that initiated the parallel operation is from `ContextTools` created by `createContext`. This sets up `currentUnctxInstance` correctly.
    *   Using `providedContext` option in scheduler functions can explicitly pass the desired context.