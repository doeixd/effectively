# 🔒 Advanced Synchronization, Context, and Resource Management Guide

Welcome to the advanced guide for "Effectively"! This document explores the intricacies of building highly concurrent and resilient applications by leveraging synchronization primitives, managing asynchronous resources robustly, and understanding the deep interplay of JavaScript's asynchronous nature with "Effectively's" context system and Web Workers.

## Table of Contents

1.  [The Challenge: Shared State in Concurrent JavaScript](#1-the-challenge-shared-state-in-concurrent-javascript)
2.  [Synchronization Primitives: `SharedArrayBuffer` and `Atomics`](#2-synchronization-primitives-sharedarraybuffer-and-atomics)
    *   Core Concepts
    *   Common Use Cases in "Effectively"
    *   When *Not* to Reach for SAB/Atomics
3.  [Using Atomics for Cross-Thread Signaling](#3-using-atomics-for-cross-thread-signaling)
    *   Example: Advanced Worker Cancellation & Progress Reporting
4.  [`AsyncLocalStorage` and Its Interaction with Parallelism/Workers](#4-asynclocalstorage-and-its-interaction-with-parallelismworkers)
    *   How "Effectively" Uses `AsyncLocalStorage` (via `unctx`)
    *   Impact on `scheduler.ts` and Worker Tasks
    *   Gotchas and Environmental Considerations
5.  [Managing Asynchronous Resources with `bracket`](#5-managing-asynchronous-resources-with-bracket)
    *   The Acquire-Use-Release Pattern
    *   Asynchronous `acquire` and `release` Phases
    *   `bracket` with Parallel Operations (Per-Task vs. Shared Resources)
    *   Resource Pooling Strategies
6.  [Context Propagation in Complex Scenarios](#6-context-propagation-in-complex-scenarios)
    *   Workers: Serialization and Isolated Contexts
    *   Scheduler: How Context Flows to Posted Tasks
    *   Ensuring `getContext()` Resolves As Expected
7.  [Advanced Patterns & Examples](#7-advanced-patterns--examples)
    *   Atomically Shared Counter (Main Thread & Worker Scenarios)
    *   Distributed Lock with Atomics (Conceptual - Use with Extreme Caution)
8.  [Performance Considerations and Trade-offs](#8-performance-considerations-and-trade-offs)
9.  [Security: `SharedArrayBuffer` and COOP/COEP Headers](#9-security-sharedarraybuffer-and-coopcoep-headers)
10. [Troubleshooting Common Issues](#10-troubleshooting-common-issues)


## 1. The Challenge: Shared State in Concurrent JavaScript

JavaScript's main thread operates on a single-threaded event loop, which simplifies state management by preventing data races on shared memory. However, the introduction of Web Workers enables true multi-threading, allowing different JavaScript realms to execute code in parallel. Even on the main thread, `async/await` can create multiple logical concurrent operations that interleave.

When these parallel or concurrent operations need to access or modify *shared mutable state*, traditional concurrency problems like race conditions, deadlocks, and data inconsistencies can emerge. "Effectively" provides tools to manage tasks and context, but direct manipulation of shared memory (especially across worker boundaries) requires careful use of primitives like `SharedArrayBuffer` and `Atomics`.


## 2. Synchronization Primitives: `SharedArrayBuffer` and `Atomics`

### Core Concepts

*   **`SharedArrayBuffer` (SAB):**
    *   A raw, fixed-size binary data buffer that can be shared between the main thread and Web Workers (and among multiple workers).
    *   Unlike regular `ArrayBuffer`s (which are copied when sent via `postMessage`), an SAB represents the *same block of memory* accessible by multiple threads.
    *   **Security Requirement:** Using SABs in web browsers requires specific HTTP headers (COOP and COEP) to be set by your server to create a secure cross-origin isolated environment. Node.js does not have this header requirement.

*   **`Atomics`:**
    *   A global object providing low-level, atomic operations on data stored in a `SharedArrayBuffer` (typically via a `TypedArray` view like `Int32Array`).
    *   **Atomic operations** are indivisible: they complete entirely without interruption from other threads, preventing race conditions during read-modify-write sequences.
    *   Key methods include:
        *   `Atomics.load(typedArray, index)`: Atomically reads a value.
        *   `Atomics.store(typedArray, index, value)`: Atomically writes a value.
        *   `Atomics.add/sub/and/or/xor(typedArray, index, value)`: Atomically perform the operation and return the *original* value at the index.
        *   `Atomics.compareExchange(typedArray, index, expectedValue, replacementValue)`: Atomically replaces the value if it matches `expectedValue`. Returns the *original* value. Crucial for implementing locks and compare-and-set operations.
        *   `Atomics.wait(typedArray, index, valueToWaitFor, timeout?)`: Puts the *calling worker thread* to sleep if the value at `typedArray[index]` is equal to `valueToWaitFor`. It wakes up if `Atomics.notify` is called on that location, the value changes, or the timeout elapses. **Cannot be used on the main browser thread as it would block UI.**
        *   `Atomics.notify(typedArray, index, count?)`: Wakes up a specified `count` of agents (or all, if `count` is `Infinity` or omitted) currently waiting on the given `SharedArrayBuffer` location.

### Common Use Cases in "Effectively"

1.  **Low-Latency Cancellation Signaling (as seen in `worker-utils.ts`):**
    *   The main thread uses `Atomics.store` to set a flag (e.g., 1) in an SAB when cancellation is requested.
    *   The worker polls this flag using `Atomics.load` (e.g., in a `setTimeout` loop) or, if its work loop is suitable, could potentially use `Atomics.wait` (though polling is often simpler for general task cancellation). This is much faster than `postMessage` for urgent signals.

2.  **Shared Counters or Status Flags:** For simple, low-level state shared between the main thread and workers, or among multiple workers (e.g., number of items processed, a "system busy" flag).

3.  **Implementing Basic Synchronization Patterns (Advanced):** Building blocks for more complex primitives like mutexes or semaphores if absolutely necessary for managing exclusive access to a resource shared across workers.

### When *Not* to Reach for SAB/Atomics (Prefer Higher-Level APIs)

*   **Complex Data Structures:** SABs are for raw binary data. For complex objects, arrays, or application state, `postMessage` combined with `seroval` (as used in `worker-utils.ts`) is generally much easier and safer for transferring data between threads.
*   **Typical UI Updates from Worker:** For a worker to update the main thread's UI, `postMessage` is the standard and appropriate mechanism. The main thread should not poll SABs in a tight loop for UI data as it can degrade performance.
*   **RPC-Style Communication:** For request-response patterns, `postMessage` and the `Promise`-based wrappers in `runOnWorker` are usually sufficient.
*   **If you don't *need* shared memory:** Avoid the complexity if tasks can work on independent data or if `postMessage` meets your communication needs.


## 3. Using Atomics for Cross-Thread Signaling

Your `worker-utils.ts` already provides an excellent example of Atomics for cancellation. The main thread sets a value in a `SharedArrayBuffer`, and the worker polls it.

**Example: Advanced Worker Communication (Conceptual - Progress + Control)**

Imagine a worker processing a large dataset. It could use different indices in an SAB for different signals:

```typescript
// Shared Definitions (accessible to main and worker, e.g., via a common types file)
const PROGRESS_SAB_INDEX_CURRENT = 0; // Stores current items processed
const PROGRESS_SAB_INDEX_TOTAL = 1;   // Stores total items
const CONTROL_SAB_INDEX_PAUSE_REQUEST = 2; // Main sets to 1 to request pause
const CONTROL_SAB_INDEX_IS_PAUSED = 3;   // Worker sets to 1 when paused

// --- Main Thread ---
// const sab = new SharedArrayBuffer(4 * 4); // 4 Int32 locations
// const controlView = new Int32Array(sab);
// const progressView = new Int32Array(sab, 4 /* byteOffset for progress part */);

// To request pause:
// Atomics.store(controlView, CONTROL_SAB_INDEX_PAUSE_REQUEST, 1);
// Atomics.notify(controlView, CONTROL_SAB_INDEX_PAUSE_REQUEST); // If worker uses Atomics.wait

// To read progress:
// const current = Atomics.load(progressView, PROGRESS_SAB_INDEX_CURRENT);
// const total = Atomics.load(progressView, PROGRESS_SAB_INDEX_TOTAL);

// --- Worker Script (`my.worker.ts`) ---
// // Task context would receive the SAB
// const task = defineTask(async (context: BaseContext & { controlSAB: SharedArrayBuffer, progressSAB: SharedArrayBuffer }, data) => {
//   const controlView = new Int32Array(context.controlSAB);
//   const progressView = new Int32Array(context.progressSAB);
//   Atomics.store(progressView, PROGRESS_SAB_INDEX_TOTAL, data.length);

//   for (let i = 0; i < data.length; i++) {
//     if (context.scope.signal.aborted) { /* Handle main cancellation */ }

//     // Check for pause request
//     if (Atomics.load(controlView, CONTROL_SAB_INDEX_PAUSE_REQUEST) === 1) {
//       Atomics.store(controlView, CONTROL_SAB_INDEX_IS_PAUSED, 1);
//       Atomics.notify(controlView, CONTROL_SAB_INDEX_IS_PAUSED);
//       // Wait until PAUSE_REQUEST is cleared (or main aborts)
//       Atomics.wait(controlView, CONTROL_SAB_INDEX_PAUSE_REQUEST, 1); // Wait while value is 1
//       Atomics.store(controlView, CONTROL_SAB_INDEX_IS_PAUSED, 0);
//       if (context.scope.signal.aborted) { /* Handle main cancellation during pause */ }
//     }
//     // ... process data[i] ...
//     Atomics.store(progressView, PROGRESS_SAB_INDEX_CURRENT, i + 1);
//   }
// });
```

**Gotchas for Atomics Signaling:**

*   **`Atomics.wait` on Main Thread:** **Forbidden.** It blocks the thread.
*   **Polling Overhead:** Constant polling with `Atomics.load` in a tight loop in the worker can consume CPU. Use `setTimeout` for polling loops, like your cancellation poll.
*   **Complexity:** Designing protocols with multiple flags and indices requires careful planning and can be error-prone. Keep it simple.
*   **Liveliness with `Atomics.wait`:** Ensure there's always a corresponding `Atomics.notify` or the value being waited upon changes, or a timeout is used, to prevent indefinite blocking.


## 4. `AsyncLocalStorage` and Its Interaction with Parallelism/Workers

Your `run.ts` leverages `unctx`, which uses `AsyncLocalStorage` (ALS) when available (Node.js) to enable implicit context propagation across `await` boundaries.

*   **How "Effectively" Uses It:**
    1.  `createContext<C>()` creates a dedicated `unctx` instance.
    2.  `ContextTools.run(task, ...)`:
        *   Sets `currentUnctxInstance` (a module-level variable in `run.ts`) to this specific `unctx` instance.
        *   Calls `thisSpecificUnctx.callAsync(executionContext, () => task(executionContext, ...))`.
        *   `unctx`'s `callAsync` uses `AsyncLocalStorage.run(context, callback)` to make `executionContext` the active context for the duration of the callback.
    3.  **Global `getContext()`:** When called, it uses `detectUnctxInstance()` which checks `currentUnctxInstance`. If found, it uses `currentUnctxInstance.use()` (which reads from ALS) to get the active context.

*   **Impact on `scheduler.ts`:**
    *   When your `scheduler.allSettled` (or other functions like `stream`) calls `getContext<C>()` (because `providedContext` was `undefined`), it correctly uses the global `getContext()`.
    *   This global `getContext()` resolves to the `executionContext` established by the `run` call that invoked the task using the scheduler (e.g., `appRun(myParallelDataProcessingTask, ...)`).
    *   When `scheduler.postTask(async () => actualTask(context, value), ...)` is called:
        *   The `context` passed to `actualTask` is the `executionContext`.
        *   The callback `async () => ...` *inherits* the `AsyncLocalStorage` context active when `scheduler.postTask` was called. This is a standard behavior of ALS with native promises and async scheduling primitives like `setTimeout`/`queueMicrotask` (used by `PromiseScheduler`) and should also hold for `globalThis.scheduler.postTask`.
        *   Therefore, if `actualTask` itself (or functions it calls) were defined using the global `defineTask` and internally use global `getContext()`, they will continue to see the correct `executionContext`.

*   **Impact on Web Workers (`worker-utils.ts`):**
    *   **ALS does NOT automatically propagate across `postMessage` to/from Web Workers.** Workers are separate execution realms.
    *   Your `worker-utils.ts` correctly handles this:
        *   **Main Thread:** It takes the `fullContext`, separates `scope`, and serializes the rest (`contextToSerialize`) to send to the worker.
        *   **Worker Thread:** `createWorkerHandler` creates its *own local* `createContext<BaseContext>({})` and thus its own `unctx` instance and ALS store. When a message arrives, it deserializes `payload.context` (which contains properties from the main thread's `contextToSerialize`) and uses these as `overrides` for its *local* `run` call.
    *   This means `getContext()` *inside a worker task* (if it uses the worker's `getContext` from its `createContext` setup) resolves to the worker's specific ALS context, correctly populated with data from the main thread. This is an excellent and robust design.

**Gotchas and Environmental Considerations for `AsyncLocalStorage`:**

*   **Environment Support:** Primarily a Node.js feature. Browsers lack native ALS (the `AsyncContext` proposal is its successor). Your `unctx` fallback to synchronous context (or no context propagation after `await` if `asyncContext: false`) is crucial for browser/other environments.
    *   If `AsyncLocalStorage` is not available or fails to initialize (e.g., in a restrictive browser environment or older Node), `unctx` might operate in a mode where `currentUnctxInstance.use()` after an `await` (inside a function not directly managed by `callAsync`'s callback) returns `undefined`.
    *   **Recommendation:** When writing highly reusable tasks or utilities *within* "Effectively" that might be used in diverse environments, if they absolutely need context after an `await` and can't rely on being directly in a `callAsync` callback, explicitly passing `context` or caching it (`const ctx = getContext(); await ...; use ctx;`) remains the most portable pattern. Your core enhancers (`withRetry`, `withTimeout`, etc.) mostly receive `context` directly, which is good.
*   **Third-Party Libraries:** Very occasionally, a third-party library that does unusual things with promises or event emitters might "break" the ALS chain. This is rare with modern libraries.


## 5. Managing Asynchronous Resources with `bracket`

Your `bracket.ts` utility is designed for the acquire-use-release pattern, essential for managing resources like connections, file handles, or even temporary worker lifecycles.

*   **Asynchronous `acquire` and `release`:**
    *   The `acquire: Task<C, V, R>` and `release: Task<C, R, void>` signatures allow these phases to be asynchronous.
    *   `bracket` ensures `release` is called via a `finally` block, even if `acquire` or `use` fails.
    *   The `context` passed to `acquire` and `release` is the context in which `bracket` itself is running.
    *   The `use: Task<CMerged, V, U>` task receives an *enhanced context* (as discussed, ideally established via your library's `provide` mechanism if `bracket` uses it internally). `getContext()` inside `use` should resolve to this `CMerged` context.

*   **`bracket` within Parallel Operations:**
    *   **Scenario 1: Each parallel task needs its own independent resource.**
        ```typescript
        // import { mapReduce } from './data-processing'; // Your data processing utils
        // import { bracket } from './bracket';
        // import { defineTask, run, createContext, BaseContext } from './run';

        // interface Item { id: string; }
        // interface Resource { data: string; close: () => Promise<void>; }
        // interface AppContext extends BaseContext { someService: any; }

        // const { run: appRun, defineTask: appDefineTask } = createContext<AppContext>({ someService: {} });

        // const acquireResourceForItem = appDefineTask(async (ctx: AppContext, item: Item): Promise<Resource> => {
        //   console.log(`[${ctx.someService}] Acquiring resource for ${item.id}`);
        //   await new Promise(r => setTimeout(r, 50));
        //   return { data: `resource_for_${item.id}`, close: async () => console.log(`Closing resource for ${item.id}`) };
        // });

        // const useTheResource = appDefineTask(async (ctx: AppContext & { itemResource: Resource }, item: Item): Promise<string> => {
        //   console.log(`Using resource ${ctx.itemResource.data} for item ${item.id}`);
        //   await new Promise(r => setTimeout(r, 100));
        //   return `processed_${item.id}_with_${ctx.itemResource.data}`;
        // });

        // const releaseTheResource = appDefineTask(async (ctx: AppContext, resource: Resource): Promise<void> => {
        //   await resource.close();
        // });

        // // Create a bracketed task that operates on a single item
        // const processItemWithBracket = bracket<AppContext, Resource, Item, string, AppContext & { itemResource: Resource }>({
        //   acquire: acquireResourceForItem,
        //   use: useTheResource,
        //   release: releaseTheResource,
        //   merge: (ctx, res) => ({ ...ctx, itemResource: res }),
        // });
        // // processItemWithBracket is now Task<AppContext, Item, string>

        // const itemsToProcess: Item[] = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];

        // // Use mapReduce. mapReduce will create Task<AppContext, null, string> for each item
        // // where `item` is closed over, and this item will be the input to processItemWithBracket.
        // const allResultsTask = mapReduce(itemsToProcess, {
        //   map: processItemWithBracket, // mapReduce's `map` option is Task<C, TItem, RMapped>
        //   reduce: (acc, result) => [...acc, result],
        //   initial: [] as string[],
        //   concurrency: 2,
        // });
        
        // async function demo() {
        //    const results = await appRun(allResultsTask, null);
        //    console.log(results); // ['processed_A_with_resource_for_A', ...]
        // }
        // demo();
        ```
        Each item processed by `mapReduce`'s `map` phase gets its own resource lifecycle managed by `bracket`.

    *   **Scenario 2: All parallel tasks share a single, managed resource (e.g., a connection pool).**
        ```typescript
        // import { scheduler } from './scheduler'; // Assuming scheduler.all is used directly
        // const acquirePool = appDefineTask(async (ctx): Promise<DbPool> => { /* ... */ return dbPool; });
        // const releasePool = appDefineTask(async (ctx, pool: DbPool) => { /* await pool.closeAll(); */ });

        // const usePoolForParallelQueries = appDefineTask(
        //   async (enhancedCtx: AppContext & { pool: DbPool }, queryInputs: string[]) => {
        //     const queryTasks: Task<AppContext & { pool: DbPool }, string, QueryResult>[] = 
        //       queryInputs.map(qi => 
        //         appDefineTask(async (ctxWithPool, singleQueryInput: string) => {
        //           // const conn = await ctxWithPool.pool.getConnection();
        //           // try { return await conn.query(singleQueryInput); } finally { conn.release(); }
        //           return `result_for_${singleQueryInput}_using_${ctxWithPool.pool.id}`; // Placeholder
        //         })
        //       );
            
        //     // Here, queryTasks need a common input. If they operate on distinct queryInputs,
        //     // we need to adapt them like in mapReduce (create tasks that close over each queryInput).
        //     const adaptedQueryTasks = queryInputs.map((qi, idx) => 
        //       appDefineTask(async (ctx, _dummy: null) => { // _dummy input
        //         // Here, ctx IS enhancedCtx due to closure and ALS propagation via scheduler.all
        //         const conn = await (ctx as AppContext & { pool: DbPool }).pool.getConnection(); // Use cast if needed
        //         try { 
        //            console.log(`Querying ${qi} on pool ${(ctx as AppContext & { pool: DbPool }).pool.id}`);
        //            return `result_for_${qi}`; 
        //         } finally { conn.release(); }
        //       })
        //     );

        //     // Use scheduler.all, passing `null` as the common input.
        //     // The `enhancedCtx` is passed as the parentContext for cancellation and for tasks to use.
        //     return scheduler.all(adaptedQueryTasks, null, { concurrency: 3 }, enhancedCtx);
        //   }
        // );

        // const runAllQueriesWithPool = bracket({
        //   acquire: acquirePool,
        //   use: usePoolForParallelQueries,
        //   release: releasePool,
        //   merge: (ctx, p) => ({ ...ctx, pool: p }),
        // });

        // // const results = await appRun(runAllQueriesWithPool, ["q1", "q2", "q3", "q4"]);
        ```
        The `bracket` manages the pool's lifecycle. The `use` task then utilizes this pool to run multiple operations in parallel, each potentially acquiring/releasing a sub-resource (like a connection) from the pool. The `enhancedCtx` (containing the pool) is available to all sub-tasks run via `scheduler.all` due to ALS propagation.

*   **Resource Pooling and Synchronization:**
    *   If `acquire` in `bracket` returns a resource from a custom pool that needs synchronization (especially across workers sharing an SAB for pool state):
        *   The pool's `acquire`/`release` methods must use `Atomics` for thread-safe updates to available resource counts/lists.
        *   `Atomics.wait` (in worker) and `Atomics.notify` can be used to pause tasks waiting for a resource and wake them when one becomes available.
    *   **Complexity Warning:** Implementing robust, fair, and deadlock-free resource pools with low-level atomics is extremely challenging. Prefer existing library solutions where possible. If building one, start simple and test rigorously.
    *   Your `bracket` utility itself doesn't need to know about this internal pool synchronization; it just calls the pool's `acquire` and `release` tasks.


## 6. Context Propagation in Complex Scenarios (Re-emphasis)

*   **Key Principle:** Your `ContextTools.run` (and `provide`) are the primary gatekeepers that establish an `AsyncLocalStorage` context via `unctx.callAsync`.
*   **Scheduler:** Functions in `scheduler.ts` that take a `providedContext?: C` or call `getContext<C>()` will correctly operate within the context established by the `run` call that invoked the task which *uses* the scheduler utility. Callbacks passed to `scheduler.postTask` inherit this ALS context.
*   **Workers:** Context is explicitly serialized (serializable parts only) and re-established as `overrides` in the worker's own isolated `run` environment. `getContext()` in a worker task sees the worker's context.
*   **Global `getContext()` in Deeply Nested Code:** If you have utility functions far down an async call stack (not directly tasks, not directly in a `scheduler.postTask` callback), and they call the global `getContext()`, their ability to see the correct specific context depends entirely on unbroken `AsyncLocalStorage` propagation from the initiating `run`. If ALS propagation is potentially broken (e.g., by certain third-party promise manipulations or non-ALS-aware native modules), these deep utilities might see the global default context or `undefined`. Explicit context passing or caching is the fallback here.


## 7. Advanced Patterns & Examples

### Atomically Shared Counter (Main Thread or Single Worker)

```typescript
// For a counter shared by tasks run via scheduler.ts on the *same* thread.
// If tasks are in different workers, they'd need an SAB passed via context.

// let simpleCounter = 0; // For main thread non-atomic comparison

// // Using a SAB for atomic operations
// const counterSAB = new SharedArrayBuffer(4); // For one Int32
// const counterViewSAB = new Int32Array(counterSAB);
// Atomics.store(counterViewSAB, 0, 0); // Initialize to 0

// const incrementTask = appDefineTask(async (ctx: AppContext, taskId: number) => {
//   // simpleCounter++; // Not atomic if tasks interleave due to await
//   const oldValue = Atomics.add(counterViewSAB, 0, 1); // Atomic increment
//   await new Promise(r => setTimeout(r, Math.random() * 10)); // Simulate work
//   console.log(`Task ${taskId} (atomic): prev=${oldValue}, new=${oldValue + 1}. Context prop: ${ctx.someProp}`);
//   return oldValue + 1;
// });

// // Adapt tasks for scheduler.all (which passes a common input, here 'null')
// const taskIds = [1, 2, 3, 4, 5];
// const adaptedTasks: Task<AppContext, null, number>[] = taskIds.map(id =>
//   appDefineTask(async (ctxInternal, _dmy: null) => incrementTask(ctxInternal, id))
// );

// const runInParallel = appDefineTask(async (ctx, _input: null) => {
//   // `ctx` here is the AppContext. It will be passed to scheduler.all,
//   // and then from scheduler.all to each adaptedTask.
//   return scheduler.all(adaptedTasks, null, { concurrency: 3 }, ctx);
// });

// async function demoCounter() {
//   // const results = await appRun(runInParallel, null);
//   // console.log("Atomic counter final value:", Atomics.load(counterViewSAB, 0)); // Should be 5
//   // console.log("Task results (new values):", results);
// }
// demoCounter();
```
This example shows how `Atomics.add` provides atomicity. The adaptation of tasks for `scheduler.all` is important: `scheduler.all` passes a *common* input to all tasks. If your tasks need unique inputs (like `taskId` here), the tasks passed to `scheduler.all` must be closures that already have that unique data.

### Distributed Lock with Atomics (Conceptual - Highly Advanced)

```typescript
// --- Conceptual: For illustration of Atomics, NOT production-ready lock ---
// const LOCK_INDEX = 0;
// const UNLOCKED = 0;
// const LOCKED = 1;
// const WAITING = 2; // Optional state if building a fair lock with a queue

// // In a SharedArrayBuffer, e.g., lockSAB = new SharedArrayBuffer(4);
// // const lockView = new Int32Array(lockSAB);
// // Atomics.store(lockView, LOCK_INDEX, UNLOCKED); // Initialize

// async function acquireDistributedLock(lockView: Int32Array, signal?: AbortSignal) { // Worker-side
//   while (true) {
//     if (signal?.aborted) throw signal.reason ?? new DOMException('Lock acquisition aborted', 'AbortError');
//     // Try to acquire the lock: change from UNLOCKED to LOCKED if it's currently UNLOCKED
//     if (Atomics.compareExchange(lockView, LOCK_INDEX, UNLOCKED, LOCKED) === UNLOCKED) {
//       return; // Lock acquired
//     }
//     // If lock is not acquired, wait until notified that it might be UNLOCKED or someone else set it to LOCKED.
//     // The value we wait for here is LOCKED, meaning "wait as long as it's locked by someone else".
//     // Timeout is crucial to prevent indefinite blocking if notify is missed or never comes.
//     Atomics.wait(lockView, LOCK_INDEX, LOCKED, 1000); // Wait if it's LOCKED, timeout 1s
//   }
// }

// function releaseDistributedLock(lockView: Int32Array) { // Worker-side
//   // To prevent a lost wakeup, it's often better if the waiter re-checks the condition
//   // after Atomics.wait returns, rather than assuming the lock is free.
//   // So, the waiter tries compareExchange again.
//   Atomics.store(lockView, LOCK_INDEX, UNLOCKED);
//   Atomics.notify(lockView, LOCK_INDEX, 1); // Wake up one waiting worker
// }

// // Usage in a worker task:
// // const workerTaskWithLock = defineTask(async (context: BaseContext & { myLockView: Int32Array }, data) => {
// //   await acquireDistributedLock(context.myLockView, context.scope.signal);
// //   try {
// //     // ... critical section ...
// //   } finally {
// //     releaseDistributedLock(context.myLockView);
// //   }
// // });
```
**EXTREME CAUTION:** Real distributed locks are incredibly difficult. This is a toy example. Issues like fairness, re-entrancy, deadlocks, and robust recovery from waiter/holder failures are complex. **Prefer well-tested libraries or design to avoid needing distributed locks if possible.**


## 8. Performance Considerations and Trade-offs

*   **SAB Overhead:** Small overhead for creation/transfer. Best for frequent, small updates/signals or truly shared large data.
*   **Atomics Speed:** `Atomics` operations are fast but uncoordinated access to the same memory location from many threads (high contention) can degrade performance due to CPU cache coherency protocols.
*   **`Atomics.wait` vs. Polling:** `Atomics.wait` is CPU-efficient for workers. Polling on the main thread is necessary but use `setTimeout` to yield.
*   **`AsyncLocalStorage`:** Highly optimized in Node.js. Overhead is typically negligible for most apps. In browsers (without transform), reliance on it for context *after `await`* in functions not directly managed by `unctx.callAsync` is risky; cache context.
*   **Serialization (`seroval`):** Very performant, but serializing huge, complex objects repeatedly will have an impact. Send only necessary data to/from workers.
*   **Task Granularity for Parallelism:** Don't parallelize extremely tiny synchronous tasks; the overhead of scheduling and context management might outweigh benefits. Parallelism shines for I/O-bound tasks or genuinely substantial CPU-bound chunks.


## 9. Security: `SharedArrayBuffer` and COOP/COEP Headers

For web applications, enabling `SharedArrayBuffer` is a security-sensitive operation due to potential side-channel attacks like Spectre. Browsers require your server to send specific HTTP headers:

```http
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Opener-Policy: same-origin
```

*   **`require-corp`**: Your top-level document can only load resources (images, scripts, iframes) from the same origin, or from other origins that explicitly opt-in via CORP (`Cross-Origin-Resource-Policy`) header.
*   **`same-origin`**: Restricts how your document can interact with cross-origin popups.

**Implications:**

*   Setting these headers can be complex if your site embeds many third-party resources that don't also send CORP headers.
*   Without these headers, `SharedArrayBuffer` will throw an error or behave like a regular `ArrayBuffer` in browsers, and `Atomics` will not work as expected for shared memory.
*   This does not apply to Node.js environments.


## 10. Troubleshooting Common Issues

*   **Race Conditions (SABs):** Data corruption or unexpected values in SABs.
    *   **Solution:** Ensure *all* reads and writes to shared memory locations that could be accessed by multiple threads concurrently are done using appropriate `Atomics` operations. Use `Atomics.compareExchange` for safe read-modify-write.
*   **Deadlocks (Custom Locks):** Application hangs when using custom locks with `Atomics.wait/notify`.
    *   **Solution:** Carefully review lock acquisition/release logic. Ensure locks are always released, even in error paths (`finally`). Avoid acquiring multiple locks in different orders across threads. Simplify locking strategy.
*   **`getContext()` Returns Wrong Context or `undefined`:**
    *   **In main thread after `await`:** If not using Node.js with working ALS or `unctx` transform, cache context: `const ctx = getContext(); await ...; use ctx;`.
    *   **In worker tasks:** Verify main thread serializes context overrides correctly. Ensure worker's `createWorkerHandler` uses these overrides in its local `run`.
    *   **In scheduler callbacks:** Ensure the outer `run` call correctly establishes ALS. Test if `AsyncLocalStorage` is working as expected in your specific scheduler path.
*   **`Atomics.wait` Times Out / Never Wakes:**
    *   Check that the `valueToWaitFor` in `Atomics.wait(typedArray, index, valueToWaitFor, ...)` is *exactly* what's at `typedArray[index]` when `wait` is called.
    *   Verify `Atomics.notify(typedArray, index, ...)` is called on the *exact same `typedArray` and `index`* from another thread *after* the value has changed in a way that should wake the waiter.
    *   Increase timeout for debugging.
*   **`SharedArrayBuffer` Not Available / `Atomics` Errors:**
    *   **Web:** Check COOP/COEP headers are correctly served and recognized by the browser.
    *   **Node.js:** Should be available in modern versions.
*   **`seroval` Serialization/Deserialization Issues:**
    *   Data loss or errors for complex types.
    *   **Solution:** Use `seroval-plugins` for Web API types (like `DOMException`). For custom classes, they might need to be registered as isomorphic references if they contain non-serializable parts (like methods) and need to be revived with full functionality.