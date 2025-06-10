/**
 * @module
 * This module provides seamless integration with Web Workers, enabling
 * computationally expensive tasks to be offloaded from the main thread.
 * It uses `seroval` for robust, type-safe data serialization and `Atomics`
 * for zero-latency cancellation, offering a complete solution for
 * production-grade multi-threading.
 */

import { defineTask, getContext, createContext, type Task, type Scope } from './run';
import type { Worker } from 'threads';
import {
  crossSerializeAsync,
  crossSerializeStream,
  fromJSON,
  getCrossReferenceHeader,
  createReference,
  createStream,
  type SerovalJSON,
  type Stream as SerovalStream,
} from 'seroval';

// --- Type Definitions ---

/**
 * The handle that a worker task receives in its context to push
 * data back to the main thread in a streaming fashion.
 */
export interface StreamHandle<T> {
  next: (value: T) => void;
  throw: (error: any) => void;
  return: () => void;
}

interface WorkerHandlerOptions {
  /** A map of isomorphic references available to tasks in this worker. */
  references?: Record<string, any>;
}

interface WorkerMessage {
  taskId: string;
  isStream: boolean;
  payload: SerovalJSON;
  cancellationBuffer: SharedArrayBuffer;
}

// --- Worker-Side Implementation ---

/**
 * Creates a message handler for a Web Worker. This function sets up the
 * worker's environment, registers tasks and isomorphic references, and
 * listens for jobs from the main thread. This function should be the
 * default export of your worker script.
 *
 * @param tasks An object mapping string IDs to the `Task`s the worker can execute.
 * @param options Optional configuration for registering isomorphic references.
 */
export function createWorkerHandler(
  tasks: Record<string, Task<any, any, any>>,
  options: WorkerHandlerOptions = {}
) {
  // 1. Initialize seroval's cross-reference scope for this worker.
  eval(getCrossReferenceHeader('worker'));

  // 2. Register any provided isomorphic references.
  if (options.references) {
    for (const key in options.references) {
      createReference(key, options.references[key]);
    }
  }

  // 3. Create an isolated `run` environment for this worker.
  const { run } = createContext({});

  // 4. Set up the main message handler.
  self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
    const { taskId, isStream, payload, cancellationBuffer } = e.data;
    const task = tasks[taskId];

    if (!task) {
      self.postMessage({ type: 'error', error: `Task "${taskId}" not found on worker.` });
      return;
    }

    // 5. Set up Atomics-based cancellation for immediate signal propagation.
    const controller = new AbortController();
    const pollCancellation = () => {
      // If main thread sets the flag to 1, abort the worker's scope.
      if (Atomics.load(new Int32Array(cancellationBuffer), 0) === 1) {
        controller.abort(new DOMException('Aborted by main thread', 'AbortError'));
      } else if (!controller.signal.aborted) {
        // Continue polling until the task is done or aborted.
        setTimeout(pollCancellation, 50);
      }
    };
    pollCancellation();

    try {
      const deserialized = fromJSON(payload) as { value: any; context: any };
      const runOptions = {
        overrides: deserialized.context,
        parentSignal: controller.signal,
      };

      if (isStream) {
        // --- Streaming Execution Path ---
        // `crossSerializeStream` will handle the result of the `run` call.
        // As the stream on the worker emits data, `onSerialize` will be called
        // with chunks of JS code to send back to the main thread.
        await crossSerializeStream(
          run(task, deserialized.value, runOptions),
          {
            scopeId: 'worker',
            onSerialize: (chunk: any) => self.postMessage(chunk),
            onError: async (err: any) => {
              self.postMessage(await crossSerializeAsync(err, { scopeId: 'worker' }));
            },
          }
        );
      } else {
        // --- Request-Response Execution Path ---
        const result = await run(task, deserialized.value, runOptions);
        const serializedResult = await crossSerializeAsync(result, { scopeId: 'worker' });
        self.postMessage(serializedResult);
      }
    } catch (error) {
      const serializedError = await crossSerializeAsync(error, { scopeId: 'worker' });
      self.postMessage(serializedError);
    }
  };
}

// --- Main-Thread Side Implementation ---

/**
 * A higher-order task that executes a task on a specified Web Worker.
 * It handles serialization, cancellation, and error propagation.
 *
 * @param worker A `Worker` instance (from `threads.js` or native).
 * @param taskId The string ID of the task to execute on the worker.
 * @returns A `Task` that, when run, will execute its logic on the worker.
 */
export function runOnWorker<C extends { scope: Scope }, V, R>(worker: Worker, taskId: string): Task<C, V, R> {
  return defineTask((value: V) => {
    return new Promise<R>(async (resolve, reject) => {
      const { scope, ...context } = getContext<C>();
      const cancellationBuffer = new SharedArrayBuffer(4);
      const cancellationArray = new Int32Array(cancellationBuffer);

      const cleanup = () => {
        scope.signal.removeEventListener('abort', onCancel);
        worker.onmessage = null;
        worker.onerror = null;
      };

      const onCancel = () => {
        Atomics.store(cancellationArray, 0, 1);
        Atomics.notify(cancellationArray, 0);
        reject(new DOMException('Aborted', 'AbortError'));
        cleanup();
      };
      scope.signal.addEventListener('abort', onCancel, { once: true });

      worker.onmessage = (e: MessageEvent<SerovalJSON>) => {
        try {
          const result = fromJSON(e.data);
          // Seroval may serialize errors as plain objects, check for that
          if (result instanceof Error) reject(result);
          else resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          cleanup();
        }
      };
      worker.onerror = (err: any) => { reject(err); cleanup(); };

      const payload = await crossSerializeAsync({ value, context }, { scopeId: 'main' });
      worker.postMessage({ taskId, isStream: false, payload, cancellationBuffer });
    });
  });
}

/**
 * A higher-order task that executes a streaming task on a worker and returns
 * an `AsyncIterable` to consume the results on the main thread.
 *
 * @param worker A `Worker` instance.
 * @param taskId The ID of the streaming task on the worker.
 * @returns A `Task` that returns an `AsyncIterable` of the results.
 */
export function runStreamOnWorker<C extends { scope: Scope }, V, R>(worker: Worker, taskId: string): Task<C, V, AsyncIterable<R>> {
  return defineTask(async (value: V) => {
    const { scope, ...context } = getContext<C>();
    const cancellationBuffer = new SharedArrayBuffer(4);

    // Create the stream proxy on the main thread that the worker will control via messages.
    const streamProxy = createStream<R>();

    const payload = await crossSerializeAsync(
      { value, context: { ...context, stream: streamProxy } },
      { scopeId: 'main' }
    );

    worker.postMessage({ taskId, isStream: true, payload, cancellationBuffer });

    // Return an async generator that bridges the stream proxy to a standard iterable.
    return (async function* () {
      const onCancel = () => {
        Atomics.store(new Int32Array(cancellationBuffer), 0, 1);
        Atomics.notify(new Int32Array(cancellationBuffer), 0);
        streamProxy.throw(new DOMException('Aborted', 'AbortError'));
        cleanup();
      };
      const cleanup = () => {
        scope.signal.removeEventListener('abort', onCancel);
        worker.onmessage = null;
      };
      scope.signal.addEventListener('abort', onCancel, { once: true });

      worker.onmessage = (e: MessageEvent<string>) => {
        // Seroval stream commands are executed here, manipulating the local streamProxy.
        try { fromJSON(e.data); } catch (err) { streamProxy.throw(err); }
      };

      try {
        // Yield values from the stream proxy as they are pushed by the worker.
        for await (const result of streamProxy) {
          yield result;
        }
      } finally {
        cleanup();
      }
    })();
  });
}