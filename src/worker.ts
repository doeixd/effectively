/**
 * @module WebWorkerUtils
 * This module provides seamless integration with native Web Workers, enabling
 * computationally expensive or I/O-bound tasks to be offloaded from the main thread.
 * It leverages `seroval` for robust, type-safe data serialization (including complex
 * objects, Errors, Promises, and its own Stream primitive) and `Atomics`
 * for efficient, low-latency cancellation signaling.
 *
 * It supports both request-response style tasks and streaming tasks where the worker
 * can push multiple results back to the main thread over time.
 *
 * **Setup:**
 * 1. **Worker Script (`my.worker.ts`):**
 *    ```typescript
 *    import { createWorkerHandler, defineTask, type BaseContext, type StreamHandle } from 'path/to/effectively';
 *    import { DOMExceptionPlugin } from 'seroval-plugins/web'; // Recommended for DOMExceptions
 *
 *    const heavyTask = defineTask(async (context: BaseContext, data: number) => {
 *      // ... do heavy work ...
 *      return data * 2;
 *    });
 *
 *    const streamingTask = defineTask(async (context: BaseContext & { stream: StreamHandle<string>}, count: number) => {
 *      for (let i = 0; i < count; i++) {
 *        if (context.scope.signal.aborted) {
 *           context.stream.throw(new DOMException('Stream aborted by worker', 'AbortError'));
 *           return;
 *        }
 *        await new Promise(r => setTimeout(r, 100));
 *        context.stream.next(`Event ${i}`);
 *      }
 *      context.stream.return();
 *    });
 *
 *    createWorkerHandler({ heavyTask, streamingTask }, {
 *      plugins: [DOMExceptionPlugin] // Optional: for serializing specific types like DOMException
 *    });
 *    ```
 *
 * 2. **Main Thread:**
 *    ```typescript
 *    import { runOnWorker, runStreamOnWorker } from 'path/to/effectively/worker-utils';
 *    import { run, createContext } from 'path/to/effectively/run';
 *
 *    const worker = new Worker(new URL('./my.worker.ts', import.meta.url), { type: 'module' });
 *    const { run: mainThreadRun } = createContext<MyAppContext>({ ... });
 *
 *    // Request-response
 *    const remoteHeavyTask = runOnWorker<MyAppContext, number, number>(worker, 'heavyTask');
 *    const result = await mainThreadRun(remoteHeavyTask, 10); // result will be 20
 *
 *    // Streaming
 *    const remoteStreamingTask = runStreamOnWorker<MyAppContext, number, string>(worker, 'streamingTask');
 *    const iterable = await mainThreadRun(remoteStreamingTask, 5);
 *    for await (const event of iterable) {
 *      console.log(event); // "Event 0", "Event 1", ...
 *    }
 *    // worker.terminate(); // When done
 *    ```
 */

import {
  defineTask,
  getContext, // Used if providedContext is not given to main thread helpers
  createContext,
  type Task,
  type BaseContext,
  type Scope,
} from './run';

import {
  crossSerializeAsync,
  crossSerializeStream,
  fromJSON,
  getCrossReferenceHeader,
  createReference,
  createStream,
  type SerovalJSON,
  type SerovalNode, // For plugin options
  type Plugin as SerovalPlugin, // For plugin options
  // type Stream as SerovalStream, // Not directly used if relying on streamToAsyncIterable
} from 'seroval';

// It's good practice to encourage users to install and use this for DOMExceptions
// import { DOMExceptionPlugin } from 'seroval-plugins/web';


// --- Type Definitions ---

/**
 * The handle provided to a worker-side streaming task via its context,
 * allowing it to push data, errors, or completion signals back to the main thread.
 * @template TNext The type of data pushed via `next()`.
 * @template TReturn The optional type of the value passed to `return()`.
 */
export interface StreamHandle<TNext, TReturn = void> {
  /** Sends a data chunk to the main thread. */
  next: (value: TNext) => void;
  /** Signals an error to the main thread, terminating the stream. */
  throw: (error: unknown) => void;
  /** Signals successful completion of the stream to the main thread. */
  return: (value?: TReturn) => void;
}

/**
 * Options for `createWorkerHandler`.
 */
interface WorkerHandlerOptions {
  /**
   * A map of isomorphic references (e.g., functions, instances) available to tasks
   * running in this worker. Keys are string identifiers, values are the actual references.
   * These references must also be registered with `createReference` on the main thread
   * if they are part of the context/payload sent from the main thread.
   */
  references?: Record<string, unknown>;
  /**
   * An array of `seroval` plugins to use during serialization/deserialization
   * on the worker side (e.g., for errors sent back to main).
   */
  plugins?: SerovalPlugin<any, SerovalNode>[];
}

/**
 * Structure of messages exchanged between main thread and worker.
 */
interface WorkerMessage {
  taskId: string;
  isStream: boolean;
  payload: SerovalJSON; // Serialized { value, context }
  cancellationBuffer: SharedArrayBuffer;
}

// --- Worker-Side Implementation ---

/**
 * Creates a message handler for a Web Worker. This function initializes the
 * worker's environment, including `seroval` cross-referencing and isomorphic
 * references. It then listens for messages from the main thread, executes
 * the requested task, and posts results (or streams data) back.
 *
 * This function should typically be the default export of your worker script.
 *
 * @param tasks An object mapping string task identifiers to the actual `Task`
 *              functions that this worker can execute.
 * @param options Optional configuration for the worker, such as isomorphic
 *                references or `seroval` plugins.
 */
export function createWorkerHandler(
  tasks: Record<string, Task<BaseContext, any, any>>, // More generic Task types for flexibility
  options: WorkerHandlerOptions = {}
): void {
  // 1. Initialize seroval's cross-reference scope for this worker.
  // This is required by seroval for its cross-reference feature ($R object).
  // It executes trusted code generated by seroval itself.
  // eslint-disable-next-line no-eval
  eval(getCrossReferenceHeader('worker'));

  // 2. Register any provided isomorphic references.
  // These allow serializing non-plain objects (like functions) by reference ID
  // if they exist in both main and worker scopes.
  if (options.references) {
    for (const key in options.references) {
      if (Object.prototype.hasOwnProperty.call(options.references, key)) {
        createReference(key, options.references[key]);
      }
    }
  }

  // 3. Create an isolated, minimal `run` environment for this worker.
  // Tasks executed in the worker will use this environment.
  // It has no default context values beyond what `createContext` provides.
  const { run, defineTask: workerDefineTask, getContext: workerGetContext } = createContext<BaseContext>({}); // Worker tasks get BaseContext

  // 4. Set up the main message handler for incoming jobs.
  self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { taskId, isStream, payload, cancellationBuffer } = event.data;
    const targetTask = tasks[taskId];

    if (!targetTask) {
      // Task not found: serialize an error object and post it back.
      const errorPayload = await crossSerializeAsync(
        new ReferenceError(`Task "${taskId}" not found on worker.`),
        { scopeId: 'worker', plugins: options.plugins }
      );
      self.postMessage(errorPayload);
      return;
    }

    // 5. Set up Atomics-based cancellation.
    // The worker polls the SharedArrayBuffer. If the main thread writes 1,
    // the worker aborts its internal AbortController.
    const workerSideAbortController = new AbortController();
    const cancellationView = new Int32Array(cancellationBuffer);

    const pollCancellation = () => {
      if (Atomics.load(cancellationView, 0) === 1) {
        workerSideAbortController.abort(new DOMException('Aborted by main thread via Atomics', 'AbortError'));
      } else if (!workerSideAbortController.signal.aborted) {
        // Continue polling until the task is done or this controller is aborted.
        // A short timeout is used to avoid a tight loop.
        setTimeout(pollCancellation, 50);
      }
    };
    pollCancellation(); // Start polling

    try {
      // Deserialize the payload from the main thread.
      // The payload contains { value (for task), context (overrides) }.
      const deserialized = fromJSON(payload, { plugins: options.plugins }) as {
        value: unknown;
        context: Record<string, unknown>; // Context overrides from main thread
      };

      // Prepare options for running the task within the worker's `run` environment.
      const runOptions = {
        overrides: deserialized.context,    // Apply context overrides from main thread
        parentSignal: workerSideAbortController.signal, // Link to our cancellable signal
      };

      if (isStream) {
        // --- Streaming Execution Path ---
        // The task `run` here is expected to be a streaming task that uses
        // `context.stream.next()`, `.throw()`, `.return()`.
        // `crossSerializeStream` handles the result of `run(targetTask, ...)`.
        // If `run` itself returns a Promise (e.g. for setup before streaming starts),
        // `crossSerializeStream` awaits it. Then, if the result is a seroval Stream
        // or an AsyncIterable, it streams it.
        // Our worker streaming tasks call `context.stream.xxx()`, so `run` resolves when task is done.
        // `crossSerializeStream` is smart enough to handle this if `deserialized.context.stream`
        // is the `seroval` Stream proxy.
        await crossSerializeStream(
          run(targetTask, deserialized.value, runOptions), // This run is worker's isolated run
          {
            scopeId: 'worker',
            onSerialize: (chunk: string) => self.postMessage(chunk), // Send JS commands to main
            onError: async (serializationError: unknown) => {
              // Error during stream serialization itself
              self.postMessage(await crossSerializeAsync(serializationError, {
                scopeId: 'worker',
                plugins: options.plugins,
              }));
            },
            plugins: options.plugins, // Ensure plugins are used for streaming content too
          }
        );
      } else {
        // --- Request-Response Execution Path ---
        const result = await run(targetTask, deserialized.value, runOptions);
        const serializedResult = await crossSerializeAsync(result, {
          scopeId: 'worker',
          plugins: options.plugins,
        });
        self.postMessage(serializedResult);
      }
    } catch (executionError) {
      // Error from task execution or deserialization
      const serializedError = await crossSerializeAsync(executionError, {
        scopeId: 'worker',
        plugins: options.plugins,
      });
      self.postMessage(serializedError);
    } finally {
      // Ensure our worker-side abort controller is signaled if not already,
      // to stop the pollCancellation loop if the task finished normally or errored.
      if (!workerSideAbortController.signal.aborted) {
        workerSideAbortController.abort(new DOMException('Task execution concluded on worker.', 'AbortError'));
      }
    }
  };

  // Optionally, signal main thread that worker is ready
  // self.postMessage({ type: 'workerReady' });
}

// --- Main-Thread Side Implementation ---

/** Options for main-thread worker task runners. */
export interface RunOnWorkerOptions {
  /**
  * An array of `seroval` plugins to use during serialization/deserialization
  * on the main thread (e.g., for arguments or results).
  */
  plugins?: SerovalPlugin<any, SerovalNode>[];
}

/**
 * Creates a `Task` that, when executed, runs a specified task on a Web Worker.
 * Handles argument/result serialization, cancellation, and error propagation.
 * This is for request-response style tasks.
 *
 * @template C The main thread context type.
 * @template V The input value type for the task.
 * @template R The result type of the task.
 * @param worker The `Worker` instance (native `globalThis.Worker`).
 * @param taskId The string identifier of the task registered in the worker.
 * @param opOptions Optional `RunOnWorkerOptions` for `seroval` plugins on the main thread.
 * @returns A `Task<C, V, R>` that delegates execution to the worker.
 */
export function runOnWorker<C extends BaseContext, V, R>(
  worker: globalThis.Worker, // Explicitly native Worker
  taskId: string,
  opOptions?: RunOnWorkerOptions
): Task<C, V, R> {
  const workerTaskLogic: Task<C, V, R> = (fullContext: C, value: V): Promise<R> => {
    return new Promise<R>(async (resolve, reject) => {
      // Separate scope from the rest of the context for serialization
      const { scope, ...contextToSerialize } = fullContext;
      const cancellationBuffer = new SharedArrayBuffer(4); // 4 bytes for an Int32
      const cancellationView = new Int32Array(cancellationBuffer);

      // Save current handlers to restore them later, preventing interference
      // if this worker instance is reused for other operations.
      const previousOnMessage = worker.onmessage;
      const previousOnError = worker.onerror;

      const cleanup = () => {
        scope.signal.removeEventListener('abort', onMainThreadCancel);
        worker.onmessage = previousOnMessage;
        worker.onerror = previousOnError;
      };

      const onMainThreadCancel = () => {
        Atomics.store(cancellationView, 0, 1); // Signal worker to abort
        Atomics.notify(cancellationView, 0);    // Notify if worker is using Atomics.wait
        // Reject the main thread promise immediately
        reject(scope.signal.reason ?? new DOMException('Operation aborted by main thread', 'AbortError'));
        cleanup();
      };

      if (scope.signal.aborted) { // Check before even setting up listeners
        return reject(scope.signal.reason ?? new DOMException('Operation aborted before worker dispatch', 'AbortError'));
      }
      scope.signal.addEventListener('abort', onMainThreadCancel, { once: true });

      worker.onmessage = (e: MessageEvent<SerovalJSON>) => {
        try {
          const deserializedResult = fromJSON(e.data, { plugins: opOptions?.plugins });

          // Robust error checking after deserialization
          if (deserializedResult instanceof Error) {
            reject(deserializedResult);
          } else if (
            deserializedResult &&
            typeof deserializedResult === 'object' &&
            'name' in deserializedResult && typeof (deserializedResult as any).name === 'string' &&
            'message' in deserializedResult && typeof (deserializedResult as any).message === 'string' &&
            !(deserializedResult instanceof Date) && !Array.isArray(deserializedResult) // Avoid common objects
          ) {
            // Attempt to reconstruct an error-like object that lost its prototype
            const errorLike = deserializedResult as { name: string; message: string; stack?: string;[key: string]: any };
            const err = new Error(errorLike.message);
            err.name = errorLike.name;
            if (errorLike.stack) err.stack = errorLike.stack;
            // Copy other potential custom error properties if necessary
            // for (const key in errorLike) {
            //   if (key !== 'name' && key !== 'message' && key !== 'stack') {
            //     (err as any)[key] = errorLike[key];
            //   }
            // }
            reject(err);
          } else {
            resolve(deserializedResult as R);
          }
        } catch (deserializationError) {
          reject(deserializationError); // Error during fromJSON
        } finally {
          cleanup();
        }
      };

      worker.onerror = (errorEvent: ErrorEvent) => {
        reject(errorEvent.error || new Error(errorEvent.message || 'Worker onerror triggered without specific error.'));
        cleanup();
      };

      try {
        const payload = await crossSerializeAsync(
          { value, context: contextToSerialize }, // Send only serializable context parts
          { scopeId: 'main', plugins: opOptions?.plugins }
        );
        worker.postMessage({ taskId, isStream: false, payload, cancellationBuffer });
      } catch (serializationError) {
        reject(serializationError); // Error during crossSerializeAsync
        cleanup();
      }
    });
  };

  Object.defineProperty(workerTaskLogic, 'name', { value: `runOnWorker(${taskId})`, configurable: true });
  Object.defineProperty(workerTaskLogic, '__task_id', { value: Symbol(`runOnWorker_${taskId}`), configurable: true, enumerable: false, writable: false });
  return workerTaskLogic;
}

/**
 * Creates a `Task` that, when executed, runs a specified streaming task on a Web Worker.
 * It returns an `AsyncIterable<R>` on the main thread that yields results as the
 * worker pushes them. Handles serialization, cancellation, and error propagation.
 *
 * @template C The main thread context type.
 * @template V The input value type for the task.
 * @template R The type of items yielded by the stream.
 * @param worker The `Worker` instance (native `globalThis.Worker`).
 * @param taskId The string identifier of the streaming task registered in the worker.
 * @param opOptions Optional `RunOnWorkerOptions` for `seroval` plugins on the main thread.
 * @returns A `Task<C, V, AsyncIterable<R>>` that delegates streaming execution to the worker.
 */
export function runStreamOnWorker<C extends BaseContext, V, R>(
  worker: globalThis.Worker, // Explicitly native Worker
  taskId: string,
  opOptions?: RunOnWorkerOptions
): Task<C, V, AsyncIterable<R>> {
  const streamWorkerTaskLogic: Task<C, V, AsyncIterable<R>> =
    async (fullContext: C, value: V): Promise<AsyncIterable<R>> => {
      const { scope, ...contextToSerialize } = fullContext;
      const cancellationBuffer = new SharedArrayBuffer(4);
      const cancellationView = new Int32Array(cancellationBuffer);

      // `streamProxy` is the Seroval Stream instance created on the main thread.
      // The worker will receive a reference to this and call its methods.
      const streamProxy = createStream<R>();

      // Save current handlers to restore them, crucial if worker is reused.
      const previousOnMessage = worker.onmessage;
      const previousOnError = worker.onerror;

      // This handler will process seroval's JS commands to drive streamProxy
      worker.onmessage = (e: MessageEvent<string>) => { // Expecting string commands from seroval stream
        try {
          // eslint-disable-next-line no-eval
          eval(e.data); // Executes commands like streamProxy.next(), .throw(), .return()
        } catch (evalError) {
          streamProxy.throw(evalError); // Propagate eval error to the stream consumer
        }
      };
      worker.onerror = (errorEvent: ErrorEvent) => {
        streamProxy.throw(errorEvent.error || new Error(errorEvent.message || 'Worker onerror during stream.'));
      };

      // Prepare payload for the worker, including the streamProxy reference
      try {
        const payload = await crossSerializeAsync(
          { value, context: { ...contextToSerialize, stream: streamProxy } },
          { scopeId: 'main', plugins: opOptions?.plugins }
        );
        worker.postMessage({ taskId, isStream: true, payload, cancellationBuffer });
      } catch (serializationError) {
        // If initial serialization fails, reject the promise that would return the iterable
        worker.onmessage = previousOnMessage; // Restore before rejecting
        worker.onerror = previousOnError;
        throw serializationError; // Re-throw to be caught by the caller of run(streamWorkerTaskLogic,...)
      }

      // Convert seroval's Stream to a standard AsyncIterable using its utility
      const asyncIterableGenerator = streamToAsyncIterable(streamProxy);
      const asyncIterable = asyncIterableGenerator(); // Get the AsyncIterableIterator

      // Create a cancellation handler for the main thread's scope
      const onMainThreadCancel = () => {
        Atomics.store(cancellationView, 0, 1);
        Atomics.notify(cancellationView, 0);
        // The worker, upon seeing the Atomics flag, should call streamProxy.throw or .return.
        // This will propagate through streamToAsyncIterable and terminate the consumer's loop.
        // We don't directly call streamProxy.throw here from main thread's abort
        // because the worker should control its stream state based on the atomic signal.
      };

      if (scope.signal.aborted) { // Check if already aborted
        onMainThreadCancel(); // Signal worker immediately
        // Restore handlers as we won't proceed to iteration
        worker.onmessage = previousOnMessage;
        worker.onerror = previousOnError;
        // Return an empty or immediately aborted iterable
        return (async function* abortedIterable() {
          throw scope.signal.reason ?? new DOMException('Stream aborted before iteration', 'AbortError');
        })();
      }
      scope.signal.addEventListener('abort', onMainThreadCancel, { once: true });

      // Wrap the iterable to ensure cleanup when iteration finishes or is broken.
      return (async function* managedAsyncIterable(): AsyncIterable<R> {
        try {
          for await (const item of asyncIterable) {
            // Before yielding, check if the main scope was aborted.
            // This is a secondary check; primary relies on worker aborting the stream.
            if (scope.signal.aborted) {
              throw scope.signal.reason ?? new DOMException('Stream consumption aborted by main thread', 'AbortError');
            }
            yield item;
          }
        } finally {
          scope.signal.removeEventListener('abort', onMainThreadCancel);
          // Restore original message/error handlers for the worker instance
          worker.onmessage = previousOnMessage;
          worker.onerror = previousOnError;
          // Ensure the worker is signaled to stop if iteration ends but worker hasn't closed stream
          // (e.g. consumer breaks loop early).
          if (Atomics.load(cancellationView, 0) === 0) { // If not already signaled
            Atomics.store(cancellationView, 0, 1);
            Atomics.notify(cancellationView, 0);
            // The worker should detect this and call stream.return() or stream.throw()
            // which would have already completed the streamProxy and thus the asyncIterable.
            // This is a "best effort" to tell a potentially lingering worker to clean up.
          }
        }
      })();
    };

  Object.defineProperty(streamWorkerTaskLogic, 'name', { value: `runStreamOnWorker(${taskId})`, configurable: true });
  Object.defineProperty(streamWorkerTaskLogic, '__task_id', { value: Symbol(`runStreamOnWorker_${taskId}`), configurable: true, enumerable: false, writable: false });
  return streamWorkerTaskLogic;
}


interface StreamListener<T> {
  next(value: T): void;
  throw(value: unknown): void;
  return(value: T): void;
}

interface Stream<T> {
  __SEROVAL_STREAM__: true;

  on(listener: StreamListener<T>): () => void;

  next(value: T): void;
  throw(value: unknown): void;
  return(value: T): void;
}

export function streamToAsyncIterable<T>(
  stream: Stream<T>,
): () => AsyncIterableIterator<T> {
  return (): AsyncIterableIterator<T> => {
    const buffer: T[] = [];
    const pending: Deferred[] = [];
    let count = 0;
    let doneAt = -1;
    let isThrow = false;

    function resolveAll(): void {
      for (let i = 0, len = pending.length; i < len; i++) {
        pending[i].resolve({ done: true, value: undefined });
      }
    }

    stream.on({
      next(value) {
        const current = pending.shift();
        if (current) {
          current.resolve({ done: false, value });
        }
        buffer.push(value);
      },
      throw(value) {
        const current = pending.shift();
        if (current) {
          current.reject(value);
        }
        resolveAll();
        doneAt = buffer.length;
        buffer.push(value as T);
        isThrow = true;
      },
      return(value) {
        const current = pending.shift();
        if (current) {
          current.resolve({ done: true, value });
        }
        resolveAll();
        doneAt = buffer.length;
        buffer.push(value);
      },
    });

    function finalize() {
      const current = count++;
      const value = buffer[current];
      if (current !== doneAt) {
        return { done: false, value };
      }
      if (isThrow) {
        throw value;
      }
      return { done: true, value };
    }

    return {
      [Symbol.asyncIterator](): AsyncIterableIterator<T> {
        return this;
      },
      async next(): Promise<IteratorResult<T>> {
        if (doneAt === -1) {
          const current = count++;
          if (current >= buffer.length) {
            const deferred = createDeferred();
            pending.push(deferred);
            return (await deferred.promise) as Promise<IteratorResult<T>>;
          }
          return { done: false, value: buffer[current] };
        }
        if (count > doneAt) {
          return { done: true, value: undefined };
        }
        return finalize();
      },
    };
  };
  }
  

interface Deferred {
  promise: Promise<unknown>;
  resolve(value: unknown): void;
  reject(value: unknown): void;
}

function createDeferred(): Deferred {
  let resolve: Deferred['resolve'];
  let reject: Deferred['reject'];
  return {
    promise: new Promise<unknown>((res, rej) => {
      resolve = res;
      reject = rej;
    }),
    resolve(value): void {
      resolve(value);
    },
    reject(value): void {
      reject(value);
    },
  };
  }
  

