# 🚀 Offload Work with Web Workers
This module provides a robust, high-level bridge to Web Workers, transforming them from a low-level browser API into a natural, integrated part of your `Effectively` application. It eliminates the boilerplate and complexity, letting you focus on your logic, not on the communication channel.

### The Pain of Using Workers Directly

Using the native Web Worker API can be cumbersome and error-prone. You've likely faced these challenges:

*   **Manual Messaging:** Juggling `postMessage` and `onmessage` listeners for every request and response, and manually correlating request IDs.
*   **Data Serialization:** Hitting the limits of `JSON.stringify` or `structuredClone`, unable to easily pass complex objects, Dates, Maps, or proper `Error` instances.
*   **Streaming Data:** Manually creating a protocol to send back chunks of data for a long-running process, which is complex to get right without race conditions.
*   **Cancellation:** Signaling a worker to stop a task has latency. Sending a "cancel" message doesn't guarantee the task stops immediately.
*   **Context & Dependencies:** Workers are isolated. Getting application-level context (like config or user info) into a worker task requires manual serialization and plumbing.
*   **Error Handling:** Errors from a worker arrive as a generic `MessageEvent`, losing their original type and stack trace, making debugging difficult.

### The Solution: An Integrated `Task`-Based API

This module solves these problems by providing a clean, `Task`-based API that handles the complexity for you:

*   ✅ **Rich Data Transfer:** Powered by `seroval`, it transparently handles complex data types, circular references, and even `Error` objects.
*   ✅ **Native `AsyncIterable` Support:** Simply write an `async function*` in your worker, and you get a standard `AsyncIterable` on the main thread.
*   ✅ **Zero-Latency Cancellation:** Uses `SharedArrayBuffer` and `Atomics` to provide instantaneous, reliable cancellation when available.
*   ✅ **Automatic Context Propagation:** Your main thread's `run` context is automatically serialized and made available inside the worker task.
*   ✅ **Proper Error Propagation:** Errors thrown in the worker are serialized, sent to the main thread, and re-thrown, preserving their type and message.
*   ✅ **Less Boilerplate:** Define tasks in the worker, then call them from the main thread as if they were local.


### ⚙️ Setup & Configuration

To use this module effectively, especially its cancellation features, your environment may need minor configuration.

#### Browser Environment

To enable `SharedArrayBuffer` (which powers zero-latency cancellation), you must serve your page with specific HTTP headers. This creates a secure cross-origin isolated context.

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without these headers, `SharedArrayBuffer` will be unavailable, and cancellation signals will not be sent.

#### Node.js Environment

No special configuration is needed. `worker_threads` and `SharedArrayBuffer` are available by default in modern Node.js versions.

#### TypeScript Configuration

Ensure your `tsconfig.json` includes the `WebWorker` library to provide correct types for the worker's global scope (`self`).

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    // ... other options
    "lib": ["ESNext", "DOM", "WebWorker"]
  }
}
```

### 🔬 How It Works Under the Hood

This module replaces manual `postMessage` calls with a structured, reliable protocol. Understanding this flow helps in debugging and advanced usage.

#### 1. Worker Script (`createWorkerHandler`)

Your worker file is the server in this client-server relationship. The `createWorkerHandler(tasks)` function is its entry point. It:
*   Creates an internal map of string `taskId`s to your `Task` functions.
*   Attaches a single, powerful message listener to the worker's global scope (`self` or `parentPort`).
*   Sends a `{ type: 'ready' }` message to the main thread to signal that it's initialized and ready to accept requests.

#### 2. Main Thread Integration (`runOnWorker` / `runStreamOnWorker`)

On the main thread, `runOnWorker` and `runStreamOnWorker` act as client-side factories. They don't execute any logic immediately. Instead, they create a "remote `Task`" that, when executed by `run()`, knows how to communicate with the worker.

#### 3. The Communication Protocol

The core of the module is a simple, `eval`-free JSON message protocol. Every message follows a defined structure.

*   **Request Message (Main -> Worker):**
    ```typescript
    interface RequestMessage {
      id: number;          // Unique ID for this specific request
      type: 'run';
      isStream: boolean;   // True if runStreamOnWorker was used
      taskId: string;        // The string key of the task to run
      payload: string;       // seroval-serialized [value, context]
      signal?: Int32Array; // View on a SharedArrayBuffer for cancellation
    }
    ```

*   **Response Message (Worker -> Main):**
    ```typescript
    interface ResponseMessage {
      id: number;          // The ID from the original request
      type: 'resolve' | 'reject' | 'stream_chunk' | 'stream_end' | 'stream_error';
      payload?: string;      // seroval-serialized result, error, or stream chunk
    }
    ```

#### 4. Handshake and State Management

*   **Ready Handshake:** Waiting for the `{ type: 'ready' }` message is crucial, especially in Node.js. It prevents a race condition where the main thread posts a message before the worker's listener is attached, which would cause the message to be lost and the task to hang.
*   **State Maps:** The main thread maintains two global maps to track pending operations:
    *   `promiseMap: Map<number, { resolve, reject }>` for request-response tasks.
    *   `streamControllerMap: Map<number, ReadableStreamDefaultController>` for streaming tasks.
    When a response arrives, its `id` is used to look up the correct handler in these maps. The maps are cleaned up upon completion, error, or cancellation to prevent memory leaks.

#### 5. Serialization (`seroval`)

*   **Context:** When you `run` a remote task, the entire `context` object you are running in, **except for the `scope` property**, is serialized and sent to the worker. The non-serializable `scope` is reconstructed inside the worker.
*   **Values:** The input `value` and any return `results` or `errors` are also passed through `seroval`. This allows for rich data transfer far beyond what `JSON.stringify` can handle.

#### 6. Streaming (`AsyncIterable`)

The streaming implementation is robust and avoids race conditions:
1.  The main thread creates a `ReadableStream`. Its `controller` is stored in the `streamControllerMap`. The stream itself (which is an `AsyncIterable`) is returned to the user.
2.  The worker executes the target task, which must be an `async function*`.
3.  For each `yield`, the worker sends a `stream_chunk` message. The main thread receives it, finds the correct controller via the message `id`, and calls `controller.enqueue()`.
4.  When the generator finishes, the worker sends a `stream_end` message. The main thread calls `controller.close()`.
5.  If the generator throws an error, a `stream_error` message is sent, and the main thread calls `controller.error()`.

#### 7. Cancellation (`Atomics`)

This module's zero-latency cancellation is powered exclusively by `Atomics` and `SharedArrayBuffer`.
*   **If these APIs are available**, a `SharedArrayBuffer` is created for the request. If the main thread's `AbortSignal` fires, `Atomics.store` and `Atomics.notify` instantly update a value in that shared memory. The worker, which is listening with the non-blocking `Atomics.waitAsync`, immediately aborts its internal `AbortController`, which is passed to the running task.
*   **If these APIs are NOT available**, the `signal` property will not be sent, and **cancellation signals for that task cannot be propagated**.


### 💡 Advanced Topics & FAQ

#### What is a `TaskIdentifier`?

It's a `string` or a `Task` object.
*   **String:** `runOnWorker(worker, 'multiply')`. This is the simplest and most common usage.
*   **Task Object:** `runOnWorker(worker, multiplyTask)`. You can also pass the `Task` object itself. The library extracts its unique internal ID (`task.__task_id.description`). This can be useful for better type-safety and refactoring.

#### How are errors from the worker handled?

When a task in the worker throws an error, the module catches it, serializes it with `seroval`, and sends it back to the main thread.
*   The error's `name` and `message` are reliably preserved. If you use `seroval-plugins` (like for `DOMException`), even more properties can be maintained.
*   The main thread re-constructs the error and rejects the `Promise` or errors the `AsyncIterable`.
*   The **stack trace** will reflect the point where the error was thrown **inside the worker**, which is useful for debugging worker-specific logic, but it will not be connected to the main thread's call stack.


### 📋 API Reference

| Function                               | Side   | Description                                                                                                                                  |
| :------------------------------------- | :----- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `createWorkerHandler(tasks, options?)` | Worker | Sets up the worker to handle task requests from the main thread.                                                                               |
| `runOnWorker(worker, taskId, opts?)`   | Main   | Creates a `Task` for a request-response operation on a worker. `taskId` can be a string or a `Task` object.                                    |
| `runStreamOnWorker(worker, taskId, opts?)`| Main | Creates a `Task` that returns an `AsyncIterable`. `taskId` can be a string or a `Task` object.                                                 |


### ⚠️ Troubleshooting

*   **Task Hangs / Never Resolves:** You likely sent a message before the worker was ready. Always wait for the `{ type: 'ready' }` message from the worker after creating it.
*   **"Task X not found on worker":** The `taskId` string you passed to `runOnWorker` doesn't match any key in the `tasks` object you gave to `createWorkerHandler`. Check for typos.
*   **"Task ... did not return an AsyncIterable":** You used `runStreamOnWorker`, but the corresponding task in the worker was not an `async function*`. The task must `yield` values.
*   **Cancellation Not Working:** Check your browser's dev tools console for warnings about `SharedArrayBuffer`. You likely need to set the COOP/COEP headers as described in the Setup section.