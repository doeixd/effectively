# 🚀 Offload Work with Web Workers

This powerful module enables you to seamlessly offload computationally intensive or I/O-bound tasks from the main thread to Web Workers. It provides a high-level API that integrates with your existing `Task` infrastructure, handling complex serialization, low-latency cancellation, and both request-response and streaming communication patterns.

**Core Features:**

*   **Effortless Parallelism:** Execute tasks in true parallelism without blocking the main UI thread.
*   **Rich Data Serialization:** Leverages `seroval` to transfer complex JavaScript objects, Promises, Errors, and even custom types (with plugins) between threads.
*   **Streaming Support:** Efficiently stream sequences of data from the worker back to the main thread using `AsyncIterable`.
*   **Zero-Latency Cancellation:** Uses `SharedArrayBuffer` and `Atomics` for immediate cancellation signaling from the main thread to the worker.
*   **Isomorphic References:** Share non-serializable objects (like functions or class instances) that exist in both environments by reference.
*   **Context Propagation:** Main thread context properties (excluding `scope`) can be serialized and provided as overrides to the task running on the worker.

### ⚙️ How It Works: Main Concepts

1.  **Worker Script (`my.worker.ts`):**
    *   You create a standard JavaScript/TypeScript file for your worker.
    *   Inside this worker script, you import `createWorkerHandler` from this module.
    *   You define the tasks the worker can perform using your library's `defineTask`.
    *   You call `createWorkerHandler`, passing it an object mapping task IDs (strings) to your defined worker tasks.

2.  **Main Thread Integration:**
    *   You create a native `new Worker(...)` instance pointing to your worker script.
    *   You use `runOnWorker` (for single results) or `runStreamOnWorker` (for multiple, streamed results) from this module. These functions take your `Worker` instance and the `taskId` (string) you want to execute.
    *   `runOnWorker` and `runStreamOnWorker` return a new `Task`. You execute this "remote task" using your main thread's `run` function, just like any other task.

3.  **Communication & Serialization:**
    *   When you `run` the remote task, this module serializes the input value and relevant parts of the main thread's context using `seroval`.
    *   This payload is sent to the worker via `postMessage`.
    *   The worker's `createWorkerHandler` deserializes the payload and executes the target task within its own isolated `run` environment, applying the received context as overrides.
    *   Results or errors from the worker task are serialized by `seroval` and sent back to the main thread, where they are deserialized and resolve/reject the main thread's promise.

4.  **Streaming:**
    *   For streaming, a `seroval` Stream object (`streamProxy`) is created on the main thread and a reference to it is sent to the worker.
    *   The worker task receives a `StreamHandle` in its context, allowing it to call `next(value)`, `throw(error)`, or `return()` on the stream.
    *   These calls are translated into JavaScript commands by `seroval`, sent to the main thread, and `eval`ed to drive the `streamProxy`.
    *   On the main thread, `runStreamOnWorker` converts this `streamProxy` into a standard `AsyncIterable` for easy consumption (`for await...of`).

5.  **Cancellation:**
    *   A `SharedArrayBuffer` is used as a flag.
    *   If the main thread's task `scope.signal` is aborted, it writes to the `SharedArrayBuffer` using `Atomics.store`.
    *   The worker polls this buffer using `Atomics.load`. If it sees the flag, it aborts its internal `AbortController`, which is passed as `parentSignal` to the task running on the worker.

### 🛠️ API Reference & Usage

#### 1. Worker-Side: `createWorkerHandler`

This function is the heart of your worker script.

| Function                                                                  | Description                                                                                                                                                                                                |
| :------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWorkerHandler(tasks: Record<string, Task<BaseContext, any, any>>, options?: WorkerHandlerOptions)` | Initializes the worker to handle tasks. Call this once in your worker script. Expose tasks by mapping a string ID to the `Task` function. |

**`WorkerHandlerOptions` Interface:**

| Property     | Type                                      | Description                                                                                                                                       |
| :----------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ |
| `references` | `Record<string, unknown>` (optional)      | Isomorphic references available to tasks (e.g., shared utility functions). Register with `createReference` from `seroval` on both main and worker. |
| `plugins`    | `SerovalPlugin<any, SerovalNode>[]` (optional) | `seroval` plugins for custom serialization/deserialization on the worker side (e.g., `DOMExceptionPlugin` for errors).                               |

**Example Worker Script (`my.worker.ts`):**

```typescript
import { 
  createWorkerHandler, 
  defineTask, // Use the global defineTask or one from a worker-specific createContext
  type BaseContext, 
  type StreamHandle,
  getContext // If tasks need to access context
} from 'path/to/your/effectively-lib'; // Adjust path
import { DOMExceptionPlugin } from 'seroval-plugins/web'; // Optional, but recommended for DOMException

// Define tasks the worker can execute
const heavyCalculation = defineTask(async (context: BaseContext, data: { value: number }) => {
  console.log('[Worker] Running heavyCalculation with scope signal:', context.scope.signal.aborted);
  for(let i=0; i < 1e9; i++) { // Simulate work
    if (context.scope.signal.aborted) {
      throw new DOMException('Heavy calculation aborted', 'AbortError');
    }
  }
  return data.value * 2;
});

interface StreamingTaskContext extends BaseContext {
  stream: StreamHandle<string, void>; // TNext = string, TReturn = void
}

const liveUpdates = defineTask(async (context: StreamingTaskContext, count: number) => {
  for (let i = 1; i <= count; i++) {
    if (context.scope.signal.aborted) {
      context.stream.throw(new DOMException('Streaming task aborted by worker', 'AbortError'));
      return; // Important to exit after signalling throw on stream
    }
    await new Promise(res => setTimeout(res, 200)); // Simulate async event
    context.stream.next(`Update ${i}/${count}`);
  }
  context.stream.return(); // Signal completion
});

// Initialize the worker
createWorkerHandler(
  {
    'calculate': heavyCalculation,
    'subscribeToUpdates': liveUpdates,
  },
  {
    plugins: [DOMExceptionPlugin], // Good for consistent error handling
    // references: { 'mySharedUtil': () => console.log('Shared util called') }
  }
);
```

**Important Notes for Worker Tasks:**

*   **Context:** Worker tasks receive a `BaseContext` by default (containing `scope`). Any additional context properties must be sent from the main thread via `overrides` when calling `runOnWorker` or `runStreamOnWorker`.
*   **Streaming Tasks:** If a task is meant to be streamed (`isStream: true`), its context will include a `stream: StreamHandle<TNext, TReturn>` property. The task *must* use `context.stream.next()`, `context.stream.throw()`, and `context.stream.return()` to communicate back to the main thread. It doesn't "return" data in the typical task sense for its stream.
*   **Cancellation:** Worker tasks should respect their `context.scope.signal` for cancellation.

#### 2. Main-Thread Side: `runOnWorker` and `runStreamOnWorker`

These functions create "remote" tasks that delegate execution to your worker.

| Function                                                                                       | Description                                                                                                                                  |
| :--------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `runOnWorker<C, V, R>(worker: globalThis.Worker, taskId: string, options?: RunOnWorkerOptions)`    | Creates a `Task` for request-response communication. Resolves/rejects with a single result/error from the worker.                            |
| `runStreamOnWorker<C, V, R>(worker: globalThis.Worker, taskId: string, options?: RunOnWorkerOptions)` | Creates a `Task` for streaming. Resolves to an `AsyncIterable<R>` that yields values pushed by the worker task using its `StreamHandle`. |

**`RunOnWorkerOptions` Interface:**

| Property  | Type                                      | Description                                                                                                   |
| :-------- | :---------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| `plugins` | `SerovalPlugin<any, SerovalNode>[]` (optional) | `seroval` plugins for serialization/deserialization on the main thread (e.g., for arguments, results, errors). |

**Example Main Thread Usage:**

```typescript
import { runOnWorker, runStreamOnWorker, type RunOnWorkerOptions } from 'path/to/your/worker-utils';
import { createContext, run } from 'path/to/your/effectively-lib';
import { DOMExceptionPlugin } from 'seroval-plugins/web'; // If using it

interface AppContext extends BaseContext { /* ... your app context ... */ }

const { run: appRun } = createContext<AppContext>({ /* ... */ });
const myWorker = new Worker(new URL('./my.worker.ts', import.meta.url), { type: 'module' });

const serovalMainThreadOptions: RunOnWorkerOptions = {
  plugins: [DOMExceptionPlugin]
};

async function performCalculations() {
  const remoteCalc = runOnWorker<AppContext, { value: number }, number>(
    myWorker, 
    'calculate',
    serovalMainThreadOptions
  );
  try {
    const result = await appRun(remoteCalc, { value: 10 });
    console.log('Remote calculation result:', result); // Expected: 20
  } catch (e) {
    console.error('Remote calculation failed:', e);
  }
}

async function subscribeToData() {
  const remoteUpdater = runStreamOnWorker<AppContext, number, string>(
    myWorker, 
    'subscribeToUpdates',
    serovalMainThreadOptions
  );
  try {
    const updatesIterable = await appRun(remoteUpdater, 5); // Request 5 updates
    for await (const update of updatesIterable) {
      console.log('Received update from worker:', update);
      // Example: if (update === 'Update 3/5') break; // To test consumer breaking loop
    }
    console.log('Stream finished.');
  } catch (e) {
    console.error('Streaming failed:', e);
  }
}

// Call them
// performCalculations();
// subscribeToData().then(() => myWorker.terminate()); // Terminate worker when done
```

### ✨ Key Benefits & Features

*   **Type Safety:** Full TypeScript support for tasks, context, arguments, and results across the worker boundary, aided by `seroval`.
*   **Complex Data Transfer:** `seroval` handles Promises, Dates, Maps, Sets, circular references, and more, making data transfer robust.
*   **Isomorphic Code:** Use `options.references` in `createWorkerHandler` to share functions or objects that exist in both main and worker environments without serializing their code.
*   **Efficient Cancellation:** `Atomics.store/load/notify` provide a very fast way to signal cancellation from the main thread to the worker, which then aborts its task execution via its `scope.signal`.
*   **Standard AsyncIterable:** `runStreamOnWorker` provides a standard `AsyncIterable` on the main thread, making consumption of streamed data idiomatic (`for await...of`).
*   **Error Propagation:** Errors (including custom errors if `seroval` plugins are used, like `DOMExceptionPlugin`) are serialized from the worker and re-thrown on the main thread, maintaining stack traces where possible.

### 💡 Tips & Gotchas

1.  **Worker Instantiation:** Remember `new Worker(new URL('./path/to/worker.ts', import.meta.url), { type: 'module' });` for ES module workers.
2.  **Serialization Limits:** While `seroval` is powerful, not everything is serializable (e.g., live DOM elements, some opaque browser objects). For functions, use isomorphic references.
3.  **Context Serialization:** When `runOnWorker` or `runStreamOnWorker` is called, it serializes `fullContext` (excluding `scope`). Ensure all properties in your `fullContext` are serializable by `seroval` or registered as isomorphic references if they need to be accessed by the worker task.
4.  **`eval()` Usage:** This module uses `eval()` in two places as required/recommended by `seroval`:
    *   `eval(getCrossReferenceHeader('worker'))` in `createWorkerHandler`: Initializes `seroval`'s global `$R` array for cross-referencing within the worker. This executes trusted code generated by `seroval`.
    *   `eval(e.data)` in `runStreamOnWorker`'s `onmessage` handler: Executes JavaScript string commands sent by `seroval` from the worker to control the main thread's `streamProxy` (e.g., `streamProxy.next(...)`). This is also part of `seroval`'s trusted streaming protocol.
    These are specific to `seroval`'s mechanics and are generally safe when used with `seroval`-generated data.
5.  **Worker Task Contract for Streams:** Worker tasks used with `runStreamOnWorker` **must** accept a `stream: StreamHandle<TNext, TReturn>` in their context and use its methods (`next`, `throw`, `return`) to send data back.
6.  **`seroval-plugins`:** For best results with web API objects like `DOMException`, `File`, `Blob`, etc., use the corresponding plugins from `seroval-plugins/web` in both the main thread's `RunOnWorkerOptions` and the worker's `WorkerHandlerOptions`.
7.  **Worker Termination:** You are responsible for terminating the worker (e.g., `worker.terminate()`) when it's no longer needed to free up resources.
8.  **Error Object Revival:** While `seroval` (especially with plugins like `DOMExceptionPlugin`) does a good job, errors crossing the worker boundary might sometimes lose their exact prototype chain. The `runOnWorker` includes a fallback to reconstruct error-like objects. Always check `error.name` and `error.message`.
9.  **SharedArrayBuffer Availability:** `Atomics`-based cancellation relies on `SharedArrayBuffer`. This is widely available in modern Node.js and browsers (with proper COOP/COEP headers for web). If `SharedArrayBuffer` is unavailable, cancellation will not be as efficient (the worker task would only stop when its `parentSignal` (the internal `AbortController`) is checked, without the immediate atomic flag). The module currently assumes `SharedArrayBuffer` is available.


###  Troubleshooting

*   **"Task X not found on worker":**
    *   Ensure the `taskId` string passed to `runOnWorker` or `runStreamOnWorker` exactly matches a key in the `tasks` object passed to `createWorkerHandler` in your worker script.
    *   Check for typos or case sensitivity issues.

*   **Data not serializing/deserializing correctly:**
    *   The object you're passing or returning might contain types not supported by `seroval` by default. Consider using `seroval-plugins` or simplifying the data.
    *   For functions or complex class instances, ensure they are registered as isomorphic references on both sides if applicable.

*   **Streaming not working / `AsyncIterable` never ends or starts:**
    *   Verify the worker task is correctly using `context.stream.next()`, `context.stream.throw()`, and especially `context.stream.return()` to signal completion.
    *   Check the main thread's `worker.onmessage` that calls `eval(e.data)` – are messages arriving from the worker? Are there errors during `eval`?
    *   Ensure the `streamProxy` is correctly passed in the serialized context to the worker.

*   **Cancellation not working immediately:**
    *   Confirm `SharedArrayBuffer` is available in your environment.
    *   Ensure the worker task frequently checks its `context.scope.signal.aborted` status, especially during long loops or before/after I/O. The Atomics flag signals the worker's internal `AbortController`, but the task logic itself needs to react to that controller's signal.

*   **`eval` related Content Security Policy (CSP) issues (Web):**
    *   If you have a strict CSP that disallows `eval` or `'unsafe-eval'`, `seroval`'s streaming mechanism (which relies on `eval` on the main thread for stream commands) might be blocked. `seroval`'s documentation might offer alternatives or CSP configurations if this is an issue. For `getCrossReferenceHeader`, it's a one-time init.
