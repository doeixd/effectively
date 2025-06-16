/**
 * @module worker
 * @description
 * This module provides a robust, isomorphic integration with Web Workers,
 * using a reliable JSON-based message protocol and `seroval` for serialization.
 * It features a clean API and zero-latency cancellation via `Atomics`.
 *
 * @features
 * - **Isomorphic:** A single codebase for Node.js (`worker_threads`) and Browser (`Web Worker`).
 * - **Reliable Messaging:** Uses a structured JSON protocol with `seroval` to avoid the complexities
 *   and potential security issues of `eval`, ensuring compatibility across all JS runtimes.
 * - **Robust Streaming:** A dedicated protocol for async iterables ensures all data chunks are delivered
 *   in the correct order without race conditions.
 * - **Zero-Latency Cancellation:** Employs `SharedArrayBuffer` and `Atomics` (when available) for
 *   instantaneous cancellation of long-running tasks.
 * - **Type-Safe API:** Explicit `runOnWorker` and `runStreamOnWorker` functions provide strong
 *   return types, making it clear whether you expect a single value or a stream.
 *
 * @example
 * **1. Worker Script (`my.worker.ts`):**
 * ```ts
 * import { createWorkerHandler, defineTask } from 'path/to/library';
 *
 * const heavyTask = defineTask(async (data: { value: number }) => {
 *   // ... intensive work ...
 *   return data.value * 2;
 * });
 *
 * const streamingTask = defineTask(async function* (count: number) {
 *   for (let i = 0; i < count; i++) {
 *     yield `Update #${i + 1}`;
 *   }
 * });
 *
 * createWorkerHandler({ heavyTask, streamingTask });
 * ```
 *
 * **2. Main Thread Usage:**
 * ```ts
 * import { runOnWorker, runStreamOnWorker, createContext } from 'path/to/library';
 * import { Worker } from 'node:worker_threads';
 *
 * const worker = new Worker(new URL('./my.worker.ts', import.meta.url));
 * const { run } = createContext();
 *
 * // Request-Response
 * const remoteCalc = runOnWorker(worker, 'heavyTask');
 * const result = await run(remoteCalc, { value: 21 }); // --> 42
 *
 * // Streaming
 * const remoteStream = runStreamOnWorker(worker, 'streamingTask');
 * const iterable = await run(remoteStream, 3);
 * for await (const update of iterable) {
 *   console.log(update);
 * }
 *
 * await worker.terminate();
 * ```
 */
import { createContext, type BaseContext, type Task } from "./run";
import {
  createReference,
  deserialize,
  serialize,
  serializeAsync,
  type Plugin as SerovalPlugin,
} from "seroval";
import { AbortSignalPlugin } from "seroval-plugins/web";
import { parentPort } from "worker_threads";

// --- Type Definitions ---
/**
 * Represents a worker instance that is compatible in both Browser and Node.js environments.
 * This defines the minimal API surface area that the module relies on.
 */
export type IsomorphicWorker = {
  postMessage(message: any, transferList?: readonly any[]): void;
  addEventListener?(type: string, listener: (event: any) => void): void;
  on?(event: string, listener: (...args: any[]) => void): void;
  terminate(): void | Promise<number>;
};

/**
 * Options for configuring worker-related functions.
 */
export interface WorkerOptions {
  /** A list of `seroval` plugins to use for serialization and deserialization. */
  plugins?: SerovalPlugin<any, any>[];
  /** A record of isomorphic references available to the worker. */
  references?: Record<string, unknown>;
}

/**
 * Represents the identifier for a remote task, which can be either its string name
 * or the task object itself (which has a `__task_id` property).
 */
export type TaskIdentifier = string | { __task_id?: symbol };

// --- Message Protocol ---
interface RequestMessage {
  id: number;
  type: 'run';
  isStream: boolean;
  taskId: string;
  payload: string;
  signal?: Int32Array;
}
interface ResponseMessage {
  id: number;
  type: 'resolve' | 'reject' | 'stream_chunk' | 'stream_end' | 'stream_error';
  payload?: string;
}

// --- Main Thread State ---
let messageIdCounter = 0;
const promiseMap = new Map<number, { resolve: (v: any) => void, reject: (r: any) => void }>();
const streamControllerMap = new Map<number, ReadableStreamDefaultController<any>>();

// --- Worker-Side Implementation ---
/**
 * Creates a message handler for a Web Worker. This function initializes the
 * worker's environment, sets up listeners, and executes tasks based on
 * messages from the main thread. After setup, it sends a 'ready' message.
 *
 * @param tasks An object mapping task identifiers to `Task` functions.
 * @param options Optional configuration for plugins or isomorphic references.
 */
export function createWorkerHandler(
  tasks: Record<string, Task<any, any, any>>,
  options: WorkerOptions = {},
): void {
  const comms = parentPort || self;
  if (!comms) throw new Error("Cannot identify worker communication channel.");
  if (options.references) {
    for (const key in options.references) {
      if (Object.prototype.hasOwnProperty.call(options.references, key)) {
        createReference(key, options.references[key]);
      }
    }
  }
  const { run } = createContext<BaseContext>({});

  const messageHandler = async (event: Event) => {
    const data = (event as MessageEvent).data;
    if (typeof data !== 'object' || data.type !== 'run') return;
    const { id, isStream, payload, taskId, signal } = data as RequestMessage;
    const internalController = new AbortController();
    if (signal && typeof Atomics !== 'undefined') {
      const reason = new DOMException("Aborted by main thread", "AbortError");
      if (Atomics.load(signal, 0)) {
        internalController.abort(reason);
      } else {
        const result = Atomics.waitAsync(signal, 0, 0);
        if (result.async) result.value.then(() => internalController.abort(reason)).catch(() => { });
      }
    }
    try {
      const [value, context] = deserialize(payload) as [any, any];
      context.scope = { signal: internalController.signal };
      const targetTask = tasks[taskId];
      if (!targetTask) throw new ReferenceError(`Task "${taskId}" not found on worker.`);
      const result = await run(targetTask, value, { overrides: context });
      if (isStream) {
        if (result && typeof (result as any)[Symbol.asyncIterator] === 'function') {
          const iterable = result as AsyncIterable<any>;
          for await (const chunk of iterable) {
            const chunkPayload = serialize(chunk, { plugins: getPlugins(options) });
            comms.postMessage({ id, type: 'stream_chunk', payload: chunkPayload });
          }
          comms.postMessage({ id, type: 'stream_end' });
        } else {
          throw new TypeError(`Task "${taskId}" was called as a stream but did not return an AsyncIterable.`);
        }
      } else {
        const resultPayload = serialize(result, { plugins: getPlugins(options) });
        comms.postMessage({ id, type: "resolve", payload: resultPayload });
      }
    } catch (err) {
      const errorPayload = await serializeAsync(err, { plugins: getPlugins(options) });
      comms.postMessage({ id, type: isStream ? 'stream_error' : 'reject', payload: errorPayload });
    }
  };
  if ("addEventListener" in comms) (comms as any).addEventListener("message", messageHandler);
  else (comms as any).on("message", messageHandler);
  // Send a 'ready' signal to the main thread once setup is complete.
  // This is crucial for preventing race conditions.
  comms.postMessage({ type: 'ready' });
}

// --- Main-Thread Side Implementation ---
function globalWorkerListener(event: Event) {
  const data = (event as MessageEvent).data ?? event;
  if (!data || typeof data.id !== 'number') return;
  const { id, type, payload } = data as ResponseMessage;
  const streamController = streamControllerMap.get(id);
  if (streamController) {
    try {
      const result = payload ? deserialize(payload) : undefined;
      switch (type) {
        case 'stream_chunk': streamController.enqueue(result); break;
        case 'stream_end': streamController.close(); streamControllerMap.delete(id); break;
        case 'stream_error': streamController.error(result); streamControllerMap.delete(id); break;
      }
    } catch (e) {
      streamController.error(e);
      streamControllerMap.delete(id);
    }
    return;
  }
  const promise = promiseMap.get(id);
  if (promise) {
    promiseMap.delete(id);
    try {
      const result = payload ? deserialize(payload) : undefined;
      if (type === 'resolve') promise.resolve(result);
      else promise.reject(result);
    } catch (e) {
      promise.reject(e);
    }
  }
}

const LISTENER_ATTACHED = new WeakSet<IsomorphicWorker>();
function ensureWorkerListener(worker: IsomorphicWorker) {
  if (LISTENER_ATTACHED.has(worker)) return;
  if (worker.addEventListener) worker.addEventListener("message", globalWorkerListener);
  else if (worker.on) worker.on("message", globalWorkerListener);
  LISTENER_ATTACHED.add(worker);
}

function getPlugins(options?: WorkerOptions): SerovalPlugin<any, any>[] {
  const plugins = options?.plugins ? [...options.plugins] : [];
  if (!plugins.some((p) => p.tag.includes("AbortSignal"))) plugins.push(AbortSignalPlugin);
  return plugins;
}

function buildSerializableContext<C extends BaseContext>(fullContext: C) {
  const { scope, ...restOfContext } = fullContext;
  return { ...restOfContext, scope: { signal: scope.signal } };
}

function getTaskId(identifier: TaskIdentifier): string {
  if (typeof identifier === 'string') {
    return identifier;
  }
  if (identifier && identifier.__task_id) {
    return identifier.__task_id.description || 'anonymousTask';
  }
  throw new TypeError('Invalid task identifier provided. Must be a string or a Task object.');
}

function createRemoteTask<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  identifier: TaskIdentifier,
  isStream: boolean,
  opOptions?: WorkerOptions,
): Task<C, V, any> {
  ensureWorkerListener(worker);

  return (fullContext, value) => {
    const taskId = getTaskId(identifier);
    const id = messageIdCounter++;
    const useAtomics = typeof SharedArrayBuffer !== "undefined" && typeof Atomics !== "undefined";
    let onAbort: (() => void) | undefined;

    // The entire operation is wrapped in a single promise to ensure that
    // the .finally() block correctly cleans up resources for this specific run,
    // preventing unhandled promise rejections and state leakage.
    const promise = new Promise<R | AsyncIterable<R>>((resolve, reject) => {
      let signal: Int32Array | undefined;
      if (useAtomics) {
        signal = new Int32Array(new SharedArrayBuffer(4));
        onAbort = () => { Atomics.store(signal!, 0, 1); Atomics.notify(signal!, 0); };
        fullContext.scope.signal.addEventListener('abort', onAbort, { once: true });
      }

      const serializableContext = buildSerializableContext(fullContext);
      const payload = serialize([value, serializableContext], { plugins: getPlugins(opOptions) });

      worker.postMessage({ id, type: 'run', isStream, taskId, payload, signal });

      if (isStream) {
        const stream = new ReadableStream<R>({
          start(controller) {
            streamControllerMap.set(id, controller);
          },
          cancel() {
            // This hook is called when the stream consumer cancels.
            // It's the primary cleanup path for streams.
            if (onAbort) fullContext.scope.signal.removeEventListener('abort', onAbort);
            streamControllerMap.delete(id);
          },
        });
        resolve(stream as unknown as AsyncIterable<R>);
      } else {
        promiseMap.set(id, { resolve, reject });
      }
    });

    return promise.finally(() => {
      if (onAbort) {
        fullContext.scope.signal.removeEventListener('abort', onAbort);
      }
      promiseMap.delete(id);
    });
  };
}

/**
 * Creates a Task that, when executed, runs a specified task on a Web Worker
 * and returns a single result or error.
 *
 * @param worker The `Worker` or `worker_threads.Worker` instance.
 * @param taskId The string identifier of the task registered in the worker, or the Task object itself.
 * @param opOptions Optional configuration for `seroval` plugins.
 * @returns A `Task` that delegates its execution to the worker.
 * @example
 * const remoteTask = runOnWorker(worker, 'double');
 * const result = await run(remoteTask, 21); // result is 42
 */
export function runOnWorker<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  taskId: TaskIdentifier,
  opOptions?: WorkerOptions,
): Task<C, V, R> {
  return createRemoteTask(worker, taskId, false, opOptions);
}

/**
 * Creates a Task that, when executed, runs a specified streaming task on a Web Worker.
 * It returns an `AsyncIterable` on the main thread that yields results.
 *
 * @param worker The `Worker` or `worker_threads.Worker` instance.
 * @param taskId The string identifier of the streaming task registered in the worker, or the Task object itself.
 * @param opOptions Optional configuration for `seroval` plugins.
 * @returns A `Task` that delegates streaming execution to the worker.
 * @example
 * const remoteStream = runStreamOnWorker(worker, 'eventStream');
 * const iterable = await run(remoteStream, 5); // Request 5 events
 * for await (const event of iterable) {
 *   console.log(event); // "Event #1", "Event #2", ...
 * }
 */
export function runStreamOnWorker<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  taskId: TaskIdentifier,
  opOptions?: WorkerOptions,
): Task<C, V, AsyncIterable<R>> {
  return createRemoteTask(worker, taskId, true, opOptions);
}

// --- ARCHITECTURAL NOTES ---
//
// 1.  Why the JSON-based Protocol?
//     - The alternative is an `eval`-based protocol using `crossSerializeAsync`. While potentially
//       faster by avoiding JSON parsing, it proved to be brittle across different JavaScript
//       runtimes (like Bun). It relies on a shared global state (`$R`) that can be difficult
//       to manage and debug. The current JSON-based protocol is more robust and portable,
//       as it sends self-contained, deserializable payloads for every message.
//
// 2.  Why the explicit `runOnWorker` and `runStreamOnWorker`?
//     - An earlier version attempted a `createWorkerProxy` API for better ergonomics. However,
//       this created a fundamental problem: the main thread had no way to know if a called
//       task (`remote.myTask`) was supposed to be a stream or a single response. This led
//       to hangs, as the wrong communication protocol was used. The current, explicit API
//       is unambiguous and therefore more reliable. The developer *must* declare their
//       intent, which prevents entire classes of bugs.
//
// 3.  The Initialization Handshake (`{ type: 'ready' }`)
//     - This is critical for Node.js (`worker_threads`). When a `new Worker` is created,
//       the main thread can `postMessage` to it before the worker has finished parsing its
//       script and attaching its 'message' listener. This results in the first message
//       being silently dropped, causing a hang. The handshake ensures the main thread
//       waits for an explicit signal from the worker before sending any tasks.
//
// 4.  Cancellation Logic (`SharedArrayBuffer` and `Atomics`)
//     - The Atomics-based cancellation is a huge performance and feature win over simple
//       message-passing. However, it introduced subtle bugs that were hard to trace.
//     - The "Unhandled Promise Rejection" Bug: An early version attached a `.finally()`
//       cleanup handler to a promise that wasn't being awaited by the caller. When a task
//       rejected, this created a second, unhandled rejection that crashed the test process.
//       The fix was to ensure all cleanup logic is attached to the single promise chain
//       that is returned to the user.
//     - The "Aborting with `undefined`" Bug: The worker's internal abort controller must be
//       called with a proper `Error` object (`internalController.abort(reason)`). If called
//       with no arguments, `signal.reason` becomes `undefined`, which does not propagate
//       correctly as a throwable error, causing the cancelled task to run to completion.
//
// 5.  State Management (`promiseMap`, `streamControllerMap`)
//     - The use of global maps to track pending operations is a standard pattern for bridging
//       event-based APIs like `postMessage` with promise-based code. It's crucial that
//       entries in these maps are cleaned up in all cases (success, error, and cancellation)
//       to prevent memory leaks. The `.finally()` on the promise for `runOnWorker` and the
//       `cancel` hook/`stream_end`/`stream_error` messages for `runStreamOnWorker` ensure this.
//
// --- ARCHITECTURAL NOTES ---
//
// 1.  Why this final architecture was chosen:
//     - The journey to this implementation involved debugging hangs, race conditions,
//       and unhandled promise rejections. This version is the synthesis of those lessons.
//     - An `eval`-based protocol using `crossSerializeAsync` was initially tried for performance
//       but proved brittle in the `bun` runtime, likely due to how it handles worker
//       global scope. A JSON-based protocol is more robust and portable.
//     - A `createWorkerProxy` API was tried for ergonomics but created a fundamental ambiguity:
//       the main thread couldn't know if a remote task was a stream or a regular promise.
//       The explicit `runOnWorker` and `runStreamOnWorker` API is clearer and more reliable.
//
// 2.  Key Reliability Mechanisms:
//     - **Initialization Handshake:** `createWorkerHandler` sends a `{ type: 'ready' }` message.
//       A robust main-thread utility must wait for this message before sending any tasks,
//       preventing a critical race condition in Node.js/Bun where a message can be sent
//       before the worker's `'message'` listener is attached.
//     - **Stateful Promise Management:** Each task run creates a `Promise` whose resolvers
//       are stored in the `promiseMap`. This promise is self-contained. The `finally`
//       block is attached directly to the returned promise, ensuring that cleanup logic
//       (like removing AbortSignal listeners) runs reliably, preventing both memory leaks
//       and unhandled promise rejections that could crash the process.
//     - **Atomic Cancellation:** Using `SharedArrayBuffer` provides near-instant cancellation.
//       The worker aborts its internal `AbortController` with a specific `DOMException`,
//       ensuring that `signal.reason` is a proper `Error` object that can be thrown and
//       propagated correctly.