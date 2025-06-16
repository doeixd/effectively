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
  removeEventListener?(type: string, listener: (event: any) => void): void;
  on?(event: string, listener: (...args: any[]) => void): void;
  off?(event: string, listener: (...args: any[]) => void): void;
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

/** A record of Task functions, used for defining a worker's capabilities. */
export type WorkerTasks = Record<string, Task<any, any, any>>;

/**
 * A type-safe proxy that mirrors the tasks defined in the worker.
 * Each property corresponds to a task and is itself a valid `Task` object.
 * This is the recommended way to interact with worker tasks.
 */
export type Remote<T extends WorkerTasks> = {
  [K in keyof T]: T[K];
};

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

interface ReadyMessage {
  type: 'ready';
  metadata: Record<string, 'request' | 'stream'>;
  workerId: string;
}

interface PingMessage {
  type: 'ping';
}

// --- Main Thread State ---

/**
 * Atomic counter for generating unique worker IDs.
 * Using crypto.randomUUID() when available for better uniqueness.
 */
function generateWorkerId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

let messageIdCounter = 0;

/**
 * Per-worker state management.
 * Each worker instance gets its own promise and stream controller maps.
 */
const WORKER_STATE = new WeakMap<IsomorphicWorker, {
  promiseMap: Map<number, { resolve: (v: any) => void, reject: (r: any) => void }>;
  streamControllerMap: Map<number, ReadableStreamDefaultController<any>>;
}>();

/**
 * Track which workers have listeners attached to prevent duplicate listeners.
 */
const LISTENER_ATTACHED = new WeakSet<IsomorphicWorker>();

/**
 * Track pending proxy initializations to avoid conflicts.
 */
const PENDING_PROXY_INIT = new WeakSet<IsomorphicWorker>();

/**
 * Get or create the state for a specific worker instance.
 */
function getWorkerState(worker: IsomorphicWorker) {
  let state = WORKER_STATE.get(worker);
  if (!state) {
    state = {
      promiseMap: new Map(),
      streamControllerMap: new Map(),
    };
    WORKER_STATE.set(worker, state);
  }
  return state;
}

// --- Utility Functions ---

/**
 * Gets the default plugins for serialization, ensuring AbortSignal support.
 */
function getPlugins(options?: WorkerOptions): SerovalPlugin<any, any>[] {
  const plugins = options?.plugins ? [...options.plugins] : [];
  if (!plugins.some((p) => p.tag.includes("AbortSignal"))) {
    plugins.push(AbortSignalPlugin);
  }
  return plugins;
}

/**
 * Builds a serializable context by extracting only the signal from scope.
 */
function buildSerializableContext<C extends BaseContext>(fullContext: C) {
  const { scope, ...restOfContext } = fullContext;
  return { ...restOfContext, scope: { signal: scope.signal } };
}

/**
 * Extracts a string task ID from various identifier formats.
 */
function getTaskId(identifier: TaskIdentifier): string {
  if (typeof identifier === 'string') {
    return identifier;
  }
  if (identifier && identifier.__task_id) {
    return identifier.__task_id.description || 'anonymousTask';
  }
  throw new TypeError('Invalid task identifier provided. Must be a string or a Task object.');
}

/**
 * Checks if SharedArrayBuffer and Atomics are available and usable.
 * They might be available but restricted due to Cross-Origin Isolation requirements.
 */
function canUseAtomics(): boolean {
  if (typeof SharedArrayBuffer === "undefined" || typeof Atomics === "undefined") {
    return false;
  }

  try {
    // Test if we can actually create and use a SharedArrayBuffer
    const testBuffer = new SharedArrayBuffer(4);
    const testArray = new Int32Array(testBuffer);
    Atomics.store(testArray, 0, 1);
    return Atomics.load(testArray, 0) === 1;
  } catch {
    return false;
  }
}

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

  // Set up isomorphic references if provided
  if (options.references) {
    for (const key in options.references) {
      if (Object.prototype.hasOwnProperty.call(options.references, key)) {
        createReference(key, options.references[key]);
      }
    }
  }

  const { run } = createContext<BaseContext>({});

  // Generate a unique worker ID for this instance
  const workerId = (globalThis as any).__worker_id__ =
    (globalThis as any).__worker_id__ ?? generateWorkerId();

  // Build metadata about available tasks
  const metadata: Record<string, 'request' | 'stream'> = {};
  for (const taskId in tasks) {
    if (Object.prototype.hasOwnProperty.call(tasks, taskId)) {
      // Read the metadata we attached in defineTask
      metadata[taskId] = tasks[taskId].__task_type || 'request';
    }
  }

  /**
   * Main message handler for processing task execution requests and ping messages.
   */
  const messageHandler = async (event: Event) => {
    const data = (event as MessageEvent).data;

    // Handle ping messages - respond with ready message
    if (data?.type === 'ping') {
      comms.postMessage({ type: 'ready', metadata, workerId });
      return;
    }

    if (typeof data !== 'object' || data.type !== 'run') return;

    const { id, isStream, payload, taskId, signal } = data as RequestMessage;
    const internalController = new AbortController();

    // Set up atomic cancellation if available
    if (signal && typeof Atomics !== 'undefined') {
      const reason = new DOMException("Aborted by main thread", "AbortError");
      if (Atomics.load(signal, 0)) {
        internalController.abort(reason);
      } else {
        const result = Atomics.waitAsync(signal, 0, 0);
        if (result.async) {
          result.value.then(() => internalController.abort(reason)).catch(() => { });
        }
      }
    }

    try {
      const [value, context] = deserialize(payload) as [any, any];
      context.scope = { signal: internalController.signal };

      const targetTask = tasks[taskId];
      if (!targetTask) {
        throw new ReferenceError(`Task "${taskId}" not found on worker.`);
      }

      const result = await run(targetTask, value, { overrides: context });

      if (isStream) {
        // Handle streaming tasks
        if (result && typeof (result as any)[Symbol.asyncIterator] === 'function') {
          const iterable = result as AsyncIterable<any>;
          try {
            for await (const chunk of iterable) {
              if (internalController.signal.aborted) break;
              const chunkPayload = serialize(chunk, { plugins: getPlugins(options) });
              comms.postMessage({ id, type: 'stream_chunk', payload: chunkPayload });
            }
            // Send end signal only if we completed successfully
            if (!internalController.signal.aborted) {
              comms.postMessage({ id, type: 'stream_end' });
            }
          } catch (streamErr) {
            // Handle errors during stream iteration
            const errorPayload = await serializeAsync(streamErr, { plugins: getPlugins(options) });
            comms.postMessage({ id, type: 'stream_error', payload: errorPayload });
            return;
          }
        } else {
          throw new TypeError(`Task "${taskId}" was called as a stream but did not return an AsyncIterable.`);
        }
      } else {
        // Handle regular request-response tasks
        const resultPayload = serialize(result, { plugins: getPlugins(options) });
        comms.postMessage({ id, type: "resolve", payload: resultPayload });
      }
    } catch (err) {
      // Handle any errors during task execution
      const errorPayload = await serializeAsync(err, { plugins: getPlugins(options) });
      comms.postMessage({
        id,
        type: isStream ? 'stream_error' : 'reject',
        payload: errorPayload
      });
    }
  };

  // Attach the message handler based on the environment
  if ("addEventListener" in comms) {
    (comms as any).addEventListener("message", messageHandler);
  } else {
    (comms as any).on("message", messageHandler);
  }

  // Send a 'ready' signal to the main thread once setup is complete.
  // This is crucial for preventing race conditions.
  comms.postMessage({ type: 'ready', metadata, workerId });
}

// --- Main-Thread Side Implementation ---

/**
 * Creates a message listener for a specific worker that handles task responses.
 * This listener ignores 'ready' messages to avoid conflicts with createWorkerProxy.
 */
function createWorkerListener(worker: IsomorphicWorker) {
  const listener = (event: Event) => {
    const data = (event as MessageEvent).data ?? event;

    // Ignore ready messages if there's a pending proxy initialization
    if (data?.type === 'ready' && PENDING_PROXY_INIT.has(worker)) return;

    // Ignore messages that aren't task responses
    if (!data || typeof data.id !== 'number') return;

    const { promiseMap, streamControllerMap } = getWorkerState(worker);
    const { id, type, payload } = data as ResponseMessage;

    // Handle streaming responses
    const streamController = streamControllerMap.get(id);
    if (streamController) {
      try {
        const result = payload ? deserialize(payload) : undefined;
        switch (type) {
          case 'stream_chunk':
            streamController.enqueue(result);
            break;
          case 'stream_end':
            streamController.close();
            streamControllerMap.delete(id);
            break;
          case 'stream_error':
            streamController.error(result);
            streamControllerMap.delete(id);
            break;
        }
      } catch (e) {
        streamController.error(e);
        streamControllerMap.delete(id);
      }
      return;
    }

    // Handle request-response promises
    const promise = promiseMap.get(id);
    if (promise) {
      try {
        const result = payload ? deserialize(payload) : undefined;
        if (type === 'resolve') {
          promise.resolve(result);
        } else {
          promise.reject(result);
        }
      } catch (e) {
        promise.reject(e);
      } finally {
        // Always clean up the promise map entry
        promiseMap.delete(id);
      }
    }
  };
  return listener;
}

/**
 * Ensures that a worker has a message listener attached.
 * Uses WeakSet to track which workers already have listeners to prevent duplicates.
 */
function ensureWorkerListener(worker: IsomorphicWorker) {
  if (LISTENER_ATTACHED.has(worker)) return;

  const listener = createWorkerListener(worker);
  if (worker.addEventListener) {
    worker.addEventListener("message", listener);
  } else if (worker.on) {
    worker.on("message", listener);
  }

  LISTENER_ATTACHED.add(worker);
}

/**
 * Overload for streaming tasks.
 * When `isStream` is `true`, the returned Task resolves to an `AsyncIterable<R>`.
 */
function createRemoteTask<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  identifier: TaskIdentifier,
  isStream: true,
  opOptions?: WorkerOptions,
): Task<C, V, AsyncIterable<R>>;

/**
 * Overload for non-streaming (request-response) tasks.
 * When `isStream` is `false`, the returned Task resolves to a single value `R`.
 */
function createRemoteTask<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  identifier: TaskIdentifier,
  isStream: false,
  opOptions?: WorkerOptions,
): Task<C, V, R>;

/**
 * Implementation of createRemoteTask. This is the core engine for all worker communication.
 * Creates a Task that delegates execution to a Web Worker.
 */
function createRemoteTask<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  identifier: TaskIdentifier,
  isStream: boolean,
  opOptions?: WorkerOptions,
): Task<C, V, R | AsyncIterable<R>> {
  ensureWorkerListener(worker);
  const { promiseMap, streamControllerMap } = getWorkerState(worker);

  return ((fullContext, value) => {
    const taskId = getTaskId(identifier);
    const id = messageIdCounter++;
    const useAtomics = canUseAtomics();

    // This promise is the core of the operation returned by the Task.
    return new Promise<R | AsyncIterable<R>>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      let signal: Int32Array | undefined;

      /**
       * Cleanup function that removes abort listeners and prevents memory leaks.
       * Called when the task is fully settled (resolved, rejected, or stream cancelled).
       */
      const cleanup = () => {
        if (onAbort && fullContext.scope.signal) {
          fullContext.scope.signal.removeEventListener('abort', onAbort);
        }
      };

      // Set up atomic cancellation if available
      if (useAtomics && fullContext.scope.signal) {
        signal = new Int32Array(new SharedArrayBuffer(4));
        onAbort = () => {
          // Send cancellation signal to the worker
          Atomics.store(signal!, 0, 1);
          Atomics.notify(signal!, 0);
        };

        if (fullContext.scope.signal.aborted) {
          // If the signal is already aborted, send the cancellation immediately
          onAbort();
        } else {
          // Otherwise, listen for it to be aborted
          fullContext.scope.signal.addEventListener('abort', onAbort, { once: true });
        }
      }

      const serializableContext = buildSerializableContext(fullContext);
      const payload = serialize([value, serializableContext], { plugins: getPlugins(opOptions) });

      // Send the task request to the worker
      worker.postMessage({ id, type: 'run', isStream, taskId, payload, signal });

      if (isStream) {
        // For streaming tasks, create a ReadableStream
        const stream = new ReadableStream<R>({
          start(controller) {
            // Register the controller so the worker listener can push data to it
            streamControllerMap.set(id, controller);
          },
          cancel() {
            // Called when the stream consumer (e.g., for-await loop) stops early
            cleanup();
            streamControllerMap.delete(id);
            // Could optionally notify the worker that the consumer has cancelled
            // worker.postMessage({ id, type: 'stream_cancel' });
          },
        });
        // For streams, the task promise resolves immediately with the stream object
        resolve(stream as unknown as R);
      } else {
        // For request-response, register a promise that will be settled by the worker listener
        promiseMap.set(id, {
          resolve: (val) => {
            cleanup();
            resolve(val);
          },
          reject: (err) => {
            cleanup();
            reject(err);
          },
        });
      }
    });
  }) as Task<C, V, R | AsyncIterable<R>>;
}

// --- Public API ---

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

/**
 * Creates a type-safe, ergonomic proxy for interacting with tasks on a Web Worker.
 *
 * This is the recommended way to use worker tasks, as it provides full
 * autocompletion and compile-time safety. The function returns a `Promise` that
 * resolves once it has established a connection with the worker and received
 * metadata about the available tasks. This metadata allows the proxy to
 * reliably distinguish between regular and streaming tasks without fragile heuristics.
 *
 * @template T - A `WorkerTasks` type definition, usually inferred from a type-only import.
 * @param {IsomorphicWorker} worker The `Worker` or `worker_threads.Worker` instance.
 * @param {WorkerOptions} [options] Optional configuration, like `seroval` plugins, to be used for all proxied tasks.
 * @returns {Promise<Remote<T>>} A `Promise` that resolves to the fully configured, type-safe proxy object. The proxy is ready to use once the promise resolves.
 * @throws {Error} Rejects if the worker does not send a 'ready' signal within the initialization timeout (10 seconds). This typically indicates an issue in the worker script, such as not calling `createWorkerHandler` or an error during its startup.
 *
 * @example
 * // 1. Define tasks in the worker file (`my.worker.ts`)
 * //    It's important that the main thread can type-import this.
 * import { createWorkerHandler, defineTask } from '@doeixd/effectively';
 *
 * const sum = defineTask(async (numbers: number[]) => {
 *   return numbers.reduce((a, b) => a + b, 0);
 * });
 *
 * const countStream = defineTask(async function* (limit: number) {
 *   for (let i = 0; i < limit; i++) {
 *     await new Promise(res => setTimeout(res, 100));
 *     yield i + 1;
 *   }
 * });
 *
 * export const tasks = { sum, countStream };
 * createWorkerHandler(tasks);
 *
 * // 2. Use the proxy on the main thread (`main.ts`)
 * import { createWorkerProxy, createContext } from '@doeixd/effectively';
 * import { Worker } from 'node:worker_threads';
 * import type { tasks } from './my.worker.ts'; // Type-only import for <T>
 *
 * async function main() {
 *   const worker = new Worker(new URL('./my.worker.ts', import.meta.url));
 *   const { run } = createContext();
 *
 *   // Note the 'await' here!
 *   const remote = await createWorkerProxy<typeof tasks>(worker);
 *
 *   // Call a regular task
 *   const total = await run(remote.sum, [10, 20, 30]);
 *   console.log(total); // --> 60
 *
 *   // Call a streaming task - the proxy handles it automatically
 *   const stream = await run(remote.countStream, 3);
 *   for await (const value of stream) {
 *     console.log(value); // --> 1, 2, 3
 *   }
 *
 *   // The resolved proxy will throw if you call a non-existent task
 *   try {
 *     await run((remote as any).nonExistentTask, {});
 *   } catch (e) {
 *     console.error(e); // --> ReferenceError: Task "nonExistentTask" is not defined in the worker.
 *   }
 *
 *   await worker.terminate();
 * }
 *
 * main();
 */
export async function createWorkerProxy<T extends WorkerTasks>(
  worker: IsomorphicWorker,
  options?: WorkerOptions,
): Promise<Remote<T>> {
  return new Promise((resolve, reject) => {
    let isResolved = false;

    // Mark this worker as having a pending proxy initialization
    PENDING_PROXY_INIT.add(worker);

    /**
     * Cleanup function that removes listeners and timeouts.
     */
    const cleanup = () => {
      clearTimeout(timeoutId);
      PENDING_PROXY_INIT.delete(worker);
      if (worker.removeEventListener) {
        worker.removeEventListener("message", readyListener);
      } else if (worker.off) {
        worker.off("message", readyListener as (...args: any[]) => void);
      }
    };

    /**
     * Listener that waits specifically for the 'ready' message from the worker.
     */
    const readyListener = (event: Event) => {
      const data = (event as MessageEvent).data ?? event;

      // Only respond to the ready message
      if (data?.type === 'ready' && data.metadata && !isResolved) {
        isResolved = true;
        cleanup();

        // Now attach the permanent, general-purpose listener for this worker
        ensureWorkerListener(worker);

        const taskMetadata: Record<string, 'request' | 'stream'> = data.metadata;
        const cache = new Map<string, Task<any, any, any>>();

        // Create the proxy that dynamically creates remote tasks
        const proxy = new Proxy({} as Remote<T>, {
          get(_, prop) {
            const taskId = prop as string;

            // Handle special JavaScript properties that shouldn't be treated as tasks
            if (typeof prop === 'symbol' ||
              prop === 'then' ||
              prop === 'catch' ||
              prop === 'finally' ||
              prop === 'constructor' ||
              prop === 'valueOf' ||
              prop === 'toString' ||
              // @ts-ignore
              prop === Symbol.toStringTag ||
              // @ts-ignore
              prop === Symbol.iterator ||
              // @ts-ignore
              prop === Symbol.asyncIterator) {
              return undefined;
            }

            // Return cached task if available
            if (cache.has(taskId)) return cache.get(taskId)!;

            // Check if the task exists in the worker
            const taskType = taskMetadata[taskId];
            if (!taskType) {
              throw new ReferenceError(`Task "${taskId}" is not defined in the worker.`);
            }

            // Create the appropriate remote task based on type
            const isStream = taskType === 'stream';
            const remoteTask = isStream
              ? runStreamOnWorker(worker, taskId, options)
              : runOnWorker(worker, taskId, options);

            // Cache the task for future use
            cache.set(taskId, remoteTask);
            return remoteTask;
          },
        });

        resolve(proxy);
      }
    };

    // Attach the ready listener FIRST
    if (worker.addEventListener) {
      worker.addEventListener("message", readyListener);
    } else if (worker.on) {
      worker.on("message", readyListener as (...args: any[]) => void);
    }

    // Send a ping message to request the ready message
    // This handles the case where the worker already sent ready before we attached the listener
    worker.postMessage({ type: 'ping' });

    // Set up timeout for worker initialization (longer timeout for debugging)
    const timeoutId = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        cleanup();
        reject(new Error("Worker initialization timed out. Did you call createWorkerHandler?"));
      }
    }, 10000);
  });
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
// 3.  The Initialization Handshake (`{ type: 'ready' }`) and Ping-Ready Protocol
//     - This is critical for Node.js (`worker_threads`). When a `new Worker` is created,
//       the main thread can `postMessage` to it before the worker has finished parsing its
//       script and attaching its 'message' listener. This results in the first message
//       being silently dropped, causing a hang. The handshake ensures the main thread
//       waits for an explicit signal from the worker before sending any tasks.
//     - The ping-ready protocol solves race conditions where `createWorkerProxy` might
//       be called after the worker has already sent its initial ready message. By sending
//       a ping, we can request a fresh ready message at any time.
//
// 4.  Cancellation Logic (`SharedArrayBuffer` and `Atomics`)
//     - The Atomics-based cancellation is a huge performance and feature win over simple
//       message-passing. However, it introduced subtle bugs that were hard to trace.
//     - The "Unhandled Promise Rejection" Bug: An early version attached a `.finally()`
//       cleanup handler to a promise that wasn't being awaited by the caller. When a task
//       rejected, this created a second, unhandled rejection that crashed the test process.
//       The fix was to ensure all cleanup logic is attached to the single promise chain
//       that is returned to the user.
//     - The "Aborting with `undefined`" Bug: The worker's internal abort controller must
//       be called with a proper `Error` object (`internalController.abort(reason)`). If called
//       with no arguments, `signal.reason` becomes `undefined`, which does not propagate
//       correctly as a throwable error, causing the cancelled task to run to completion.
//
// 5.  State Management (`promiseMap`, `streamControllerMap`)
//     - The use of WeakMap-based state tracking for pending operations is a standard pattern
//       for bridging event-based APIs like `postMessage` with promise-based code. It's crucial
//       that entries in these maps are cleaned up in all cases (success, error, and cancellation)
//       to prevent memory leaks. The cleanup logic in promise resolvers/rejecters and the
//       `cancel` hook/`stream_end`/`stream_error` messages for streams ensure this.
//
// 6.  Worker ID Generation and Race Conditions
//     - Using crypto.randomUUID() when available provides much better uniqueness guarantees
//       than a simple counter. The fallback combines timestamp and random string for
//       environments without crypto support.
//
// 7.  SharedArrayBuffer Availability Check
//     - SharedArrayBuffer might be available but restricted due to Cross-Origin Isolation
//       requirements in browsers. The canUseAtomics() function tests actual usability
//       rather than just availability.
//
// 8.  Memory Leak Prevention
//     - Each worker gets its own state maps via WeakMap, ensuring automatic cleanup when
//       workers are garbage collected.
//     - Listeners are tracked via WeakSet to prevent duplicate attachment.
//     - Promise map entries are always deleted after resolution/rejection.
//     - Stream controllers are properly cleaned up on end/error/cancel.
//
// 9.  Error Handling Robustness
//     - Stream iteration errors are properly caught and sent as stream_error messages.
//     - Task validation happens before execution with clear error messages.
//     - Proxy property access validates task existence and throws meaningful errors.
//     - Serialization errors are caught and properly propagated.
//
// 10. Race Condition Prevention
//     - The createWorkerProxy uses an isResolved flag to prevent double resolution.
//     - Ready message listeners are removed immediately after handling.
//     - Cleanup functions are idempotent and safe to call multiple times.
//     - PENDING_PROXY_INIT WeakSet prevents message conflicts during proxy initialization.