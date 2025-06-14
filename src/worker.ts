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
 * @example
 * **Setup:**
 *
 * 1. **Worker Script (`my.worker.ts`):**
 *    ```typescript
 *    import { createWorkerHandler, defineTask, getContext, type BaseContext, type StreamHandle } from 'effectively';
 *    import { DOMExceptionPlugin } from 'seroval-plugins/web'; // Recommended for DOMExceptions
 *
 *    // A simple request-response task
 *    const heavyTask = defineTask(async (data: number) => {
 *      // ... do heavy work ...
 *      if (getContext<BaseContext>().scope.signal.aborted) throw new Error("Aborted");
 *      return data * 2;
 *    });
 *
 *    // A streaming task
 *    const streamingTask = defineTask(async (count: number) => {
 *      const context = getContext<{ stream: StreamHandle<string> }>();
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
 *      plugins: [DOMExceptionPlugin]
 *    });
 *    ```
 *
 * 2. **Main Thread:**
 *    ```typescript
 *    import { runOnWorker, runStreamOnWorker } from 'effectively/worker';
 *    import { run, createContext } from 'effectively';
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
  getContext,
  createContext,
  type Task,
  type BaseContext,
  type Scope,
} from "./run";

import {
  crossSerializeAsync,
  crossSerializeStream,
  fromJSON,
  getCrossReferenceHeader,
  createReference,
  createStream,
  type SerovalJSON,
  type Plugin as SerovalPlugin,
} from "seroval";

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
  plugins?: SerovalPlugin<any, any>[];
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
  tasks: Record<string, Task<BaseContext, any, any>>,
  options: WorkerHandlerOptions = {},
): void {
  // eslint-disable-next-line no-eval
  eval(getCrossReferenceHeader("worker"));

  if (options.references) {
    for (const key in options.references) {
      if (Object.prototype.hasOwnProperty.call(options.references, key)) {
        createReference(key, options.references[key]);
      }
    }
  }

  const { run } = createContext<BaseContext>({});

  self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
    const { taskId, isStream, payload, cancellationBuffer } = event.data;
    const targetTask = tasks[taskId];

    if (!targetTask) {
      const errorPayload = await crossSerializeAsync(
        new ReferenceError(`Task "${taskId}" not found on worker.`),
        { scopeId: "worker", plugins: options.plugins },
      );
      self.postMessage(errorPayload);
      return;
    }

    const workerSideAbortController = new AbortController();
    const cancellationView = new Int32Array(cancellationBuffer);

    const pollCancellation = () => {
      if (Atomics.load(cancellationView, 0) === 1) {
        workerSideAbortController.abort(
          new DOMException("Aborted by main thread via Atomics", "AbortError"),
        );
      } else if (!workerSideAbortController.signal.aborted) {
        setTimeout(pollCancellation, 50);
      }
    };
    pollCancellation();

    try {
      const deserialized = fromJSON(payload, { plugins: options.plugins }) as {
        value: unknown;
        context: Record<string, unknown>;
      };

      const runOptions = {
        overrides: deserialized.context,
        parentSignal: workerSideAbortController.signal,
      };

      if (isStream) {
        await crossSerializeStream(
          run(targetTask, deserialized.value, runOptions),
          {
            scopeId: "worker",
            onSerialize: (chunk: string) => self.postMessage(chunk),
            onError: async (serializationError: unknown) => {
              self.postMessage(
                await crossSerializeAsync(serializationError, {
                  scopeId: "worker",
                  plugins: options.plugins,
                }),
              );
            },
            plugins: options.plugins,
          },
        );
      } else {
        const result = await run(targetTask, deserialized.value, runOptions);
        const serializedResult = await crossSerializeAsync(result, {
          scopeId: "worker",
          plugins: options.plugins,
        });
        self.postMessage(serializedResult);
      }
    } catch (executionError) {
      const serializedError = await crossSerializeAsync(executionError, {
        scopeId: "worker",
        plugins: options.plugins,
      });
      self.postMessage(serializedError);
    } finally {
      if (!workerSideAbortController.signal.aborted) {
        workerSideAbortController.abort(
          new DOMException("Task execution concluded on worker.", "AbortError"),
        );
      }
    }
  };
}

// --- Main-Thread Side Implementation ---

/** Options for main-thread worker task runners. */
export interface RunOnWorkerOptions {
  /**
   * An array of `seroval` plugins to use during serialization/deserialization
   * on the main thread (e.g., for arguments or results).
   */
  plugins?: SerovalPlugin<any, any>[];
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
  worker: globalThis.Worker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, R> {
  const workerTaskLogic: Task<C, V, R> = (
    fullContext: C,
    value: V,
  ): Promise<R> => {
    return new Promise<R>(async (resolve, reject) => {
      const { scope, ...contextToSerialize } = fullContext;
      const cancellationBuffer = new SharedArrayBuffer(4);
      const cancellationView = new Int32Array(cancellationBuffer);

      const previousOnMessage = worker.onmessage;
      const previousOnError = worker.onerror;

      const cleanup = () => {
        scope.signal.removeEventListener("abort", onMainThreadCancel);
        worker.onmessage = previousOnMessage;
        worker.onerror = previousOnError;
      };

      const onMainThreadCancel = () => {
        Atomics.store(cancellationView, 0, 1);
        Atomics.notify(cancellationView, 0);
        reject(
          scope.signal.reason ??
            new DOMException("Operation aborted by main thread", "AbortError"),
        );
        cleanup();
      };

      if (scope.signal.aborted) {
        return reject(
          scope.signal.reason ??
            new DOMException(
              "Operation aborted before worker dispatch",
              "AbortError",
            ),
        );
      }
      scope.signal.addEventListener("abort", onMainThreadCancel, {
        once: true,
      });

      worker.onmessage = (e: MessageEvent<SerovalJSON>) => {
        try {
          const deserializedResult = fromJSON(e.data, {
            plugins: opOptions?.plugins,
          });

          if (deserializedResult instanceof Error) {
            reject(deserializedResult);
          } else if (
            deserializedResult &&
            typeof deserializedResult === "object" &&
            "name" in deserializedResult &&
            typeof (deserializedResult as any).name === "string" &&
            "message" in deserializedResult &&
            typeof (deserializedResult as any).message === "string"
          ) {
            const errorLike = deserializedResult as {
              name: string;
              message: string;
              stack?: string;
              cause?: unknown;
            };
            const err = new Error(errorLike.message, {
              cause: errorLike.cause,
            });
            err.name = errorLike.name;
            if (errorLike.stack) err.stack = errorLike.stack;
            reject(err);
          } else {
            resolve(deserializedResult as R);
          }
        } catch (deserializationError) {
          reject(deserializationError);
        } finally {
          cleanup();
        }
      };

      worker.onerror = (errorEvent: ErrorEvent) => {
        reject(
          errorEvent.error ||
            new Error(
              errorEvent.message ||
                "Worker onerror triggered without specific error.",
            ),
        );
        cleanup();
      };

      try {
        const payload = await crossSerializeAsync(
          { value, context: contextToSerialize },
          { scopeId: "main", plugins: opOptions?.plugins },
        );
        worker.postMessage({
          taskId,
          isStream: false,
          payload,
          cancellationBuffer,
        });
      } catch (serializationError) {
        reject(serializationError);
        cleanup();
      }
    });
  };

  Object.defineProperty(workerTaskLogic, "name", {
    value: `runOnWorker(${taskId})`,
    configurable: true,
  });
  Object.defineProperty(workerTaskLogic, "__task_id", {
    value: Symbol(`runOnWorker_${taskId}`),
    configurable: true,
    enumerable: false,
    writable: false,
  });
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
  worker: globalThis.Worker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, AsyncIterable<R>> {
  const streamWorkerTaskLogic: Task<C, V, AsyncIterable<R>> = async (
    fullContext: C,
    value: V,
  ): Promise<AsyncIterable<R>> => {
    const { scope, ...contextToSerialize } = fullContext;
    const cancellationBuffer = new SharedArrayBuffer(4);
    const cancellationView = new Int32Array(cancellationBuffer);

    const streamProxy = createStream<R>();

    const previousOnMessage = worker.onmessage;
    const previousOnError = worker.onerror;

    worker.onmessage = (e: MessageEvent<string>) => {
      try {
        // eslint-disable-next-line no-eval
        eval(e.data);
      } catch (evalError) {
        streamProxy.throw(evalError);
      }
    };
    worker.onerror = (errorEvent: ErrorEvent) => {
      streamProxy.throw(
        errorEvent.error ||
          new Error(errorEvent.message || "Worker onerror during stream."),
      );
    };

    try {
      const payload = await crossSerializeAsync(
        { value, context: { ...contextToSerialize, stream: streamProxy } },
        { scopeId: "main", plugins: opOptions?.plugins },
      );
      worker.postMessage({
        taskId,
        isStream: true,
        payload,
        cancellationBuffer,
      });
    } catch (serializationError) {
      worker.onmessage = previousOnMessage;
      worker.onerror = previousOnError;
      throw serializationError;
    }

    const asyncIterableGenerator = streamToAsyncIterable(streamProxy);
    const asyncIterable = asyncIterableGenerator();

    const onMainThreadCancel = () => {
      Atomics.store(cancellationView, 0, 1);
      Atomics.notify(cancellationView, 0);
    };

    if (scope.signal.aborted) {
      onMainThreadCancel();
      worker.onmessage = previousOnMessage;
      worker.onerror = previousOnError;
      return (async function* abortedIterable() {
        throw (
          scope.signal.reason ??
          new DOMException("Stream aborted before iteration", "AbortError")
        );
      })();
    }
    scope.signal.addEventListener("abort", onMainThreadCancel, { once: true });

    return (async function* managedAsyncIterable(): AsyncIterable<R> {
      try {
        for await (const item of asyncIterable) {
          if (scope.signal.aborted) {
            throw (
              scope.signal.reason ??
              new DOMException(
                "Stream consumption aborted by main thread",
                "AbortError",
              )
            );
          }
          yield item;
        }
      } finally {
        scope.signal.removeEventListener("abort", onMainThreadCancel);
        worker.onmessage = previousOnMessage;
        worker.onerror = previousOnError;
        if (Atomics.load(cancellationView, 0) === 0) {
          Atomics.store(cancellationView, 0, 1);
          Atomics.notify(cancellationView, 0);
        }
      }
    })();
  };

  Object.defineProperty(streamWorkerTaskLogic, "name", {
    value: `runStreamOnWorker(${taskId})`,
    configurable: true,
  });
  Object.defineProperty(streamWorkerTaskLogic, "__task_id", {
    value: Symbol(`runStreamOnWorker_${taskId}`),
    configurable: true,
    enumerable: false,
    writable: false,
  });
  return streamWorkerTaskLogic;
}

// --- Internal seroval stream-to-iterable implementation ---

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

function streamToAsyncIterable<T>(
  stream: Stream<T>,
): () => AsyncIterableIterator<T> {
  return (): AsyncIterableIterator<T> => {
    const buffer: T[] = [];
    const pending: Deferred[] = [];
    let count = 0;
    let doneAt = -1;
    let isThrow = false;

    function resolveAll(): void {
      for (const deferred of pending) {
        deferred.resolve({ done: true, value: undefined });
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
  let resolve!: (value: unknown) => void;
  let reject!: (value: unknown) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
