/**
 * @module
 * This module provides seamless integration with native Web Workers, enabling
 * computationally expensive or I/O-bound tasks to be offloaded from the main thread.
 * It leverages `seroval` for robust, type-safe data serialization and `Atomics`
 * for efficient, low-latency cancellation signaling.
 */

import {
  createContext,
  type BaseContext,
  type Task,
  WorkflowError,
} from "./run";
import {
  toJSONAsync,
  fromJSON,
  getCrossReferenceHeader,
  createReference,
  crossSerializeStream,
  createStream as createSerovalStream,
  type SerovalJSON,
  type Plugin as SerovalPlugin,
  type Stream as SerovalStream,
} from "seroval";

// --- Seroval Stream-to-Iterable Bridge ---
interface Deferred {
  promise: Promise<any>;
  resolve(value: any): void;
  reject(value: any): void;
}
function createDeferred(): Deferred {
  let resolve!: (value: any) => void;
  let reject!: (value: any) => void;
  const promise = new Promise<any>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function streamToAsyncIterable<T>(
  stream: SerovalStream<T>,
): AsyncIterableIterator<T> {
  const buffer: T[] = [];
  const pending: Deferred[] = [];
  let count = 0;
  let doneAt = -1;
  let isThrow = false;

  stream.on({
    next(value) {
      const current = pending.shift();
      if (current) {
        current.resolve({ done: false, value });
      } else {
        buffer.push(value);
      }
    },
    throw(value) {
      const current = pending.shift();
      if (current) {
        current.reject(value);
      }
      for (const deferred of pending)
        deferred.resolve({ done: true, value: undefined });
      doneAt = buffer.length;
      buffer.push(value as T);
      isThrow = true;
    },
    return(value) {
      const current = pending.shift();
      if (current) {
        current.resolve({ done: true, value });
      }
      for (const deferred of pending)
        deferred.resolve({ done: true, value: undefined });
      doneAt = buffer.length;
      buffer.push(value);
    },
  });

  function finalize() {
    const current = count++;
    const value = buffer[current];
    if (current !== doneAt) return { done: false, value };
    if (isThrow) throw value;
    return { done: true, value };
  }

  return {
    [Symbol.asyncIterator](): AsyncIterableIterator<T> {
      return this;
    },
    async next(): Promise<IteratorResult<T>> {
      if (doneAt === -1) {
        const current = count++;
        if (current < buffer.length)
          return { done: false, value: buffer[current] };
        const deferred = createDeferred();
        pending.push(deferred);
        return await deferred.promise;
      }
      if (count > doneAt) return { done: true, value: undefined as any };
      return finalize();
    },
  };
}

// --- Type Definitions ---
export interface MinimalWorker {
  postMessage(message: any, transfer?: any[]): void;
  terminate(): void | Promise<any>;
}
interface WebWorkerListener {
  addEventListener(
    type: "message" | "error",
    listener: (event: any) => void,
  ): void;
  removeEventListener(
    type: "message" | "error",
    listener: (event: any) => void,
  ): void;
}
interface NodeWorkerListener {
  on(event: "message" | "error", listener: (payload: any) => void): this;
  off(event: "message" | "error", listener: (payload: any) => void): this;
}
export type IsomorphicWorker = MinimalWorker &
  (WebWorkerListener | NodeWorkerListener);

interface WorkerHandlerOptions {
  references?: Record<string, unknown>;
  plugins?: SerovalPlugin<any, any>[];
}
export interface RunOnWorkerOptions {
  plugins?: SerovalPlugin<any, any>[];
}
interface PendingRequest {
  resolve(value: any): void;
  reject(reason?: any): void;
  cleanup(): void;
}
interface WorkerRequest {
  type: "request" | "stream_request";
  id: number;
  taskId: string;
  payload: SerovalJSON;
  cancellationBuffer: SharedArrayBuffer;
}
interface WorkerResponse {
  id: number;
  type: "result" | "error" | "stream_start";
  payload: SerovalJSON | null;
}
const workerPendingRequests = new WeakMap<
  IsomorphicWorker,
  Map<number, PendingRequest>
>();
let messageIdCounter = 0;

// --- Worker-Side Implementation ---
export function createWorkerHandler(
  tasks: Record<string, Task<BaseContext, any, any>>,
  options: WorkerHandlerOptions = {},
): void {
  eval(getCrossReferenceHeader("worker"));
  if (options.references) {
    for (const key in options.references) {
      if (Object.prototype.hasOwnProperty.call(options.references, key)) {
        createReference(key, options.references[key]);
      }
    }
  }
  const { run } = createContext<BaseContext>({});

  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const {
      id,
      taskId,
      payload,
      cancellationBuffer,
      type: requestType,
    } = event.data;

    const targetTask = tasks[taskId];
    if (!targetTask) {
      self.postMessage({
        id,
        type: "error",
        payload: await toJSONAsync(
          new ReferenceError(`Task "${taskId}" not found.`),
        ),
      });
      return;
    }

    const workerSideAbortController = new AbortController();
    if (cancellationBuffer) {
      const view = new Int32Array(cancellationBuffer);
      const poll = () => {
        if (Atomics.load(view, 0) === 1)
          workerSideAbortController.abort(
            new DOMException("Aborted by main thread", "AbortError"),
          );
        else if (!workerSideAbortController.signal.aborted)
          setTimeout(poll, 50);
      };
      poll();
    }

    try {
      const deserialized = fromJSON(payload, { plugins: options.plugins }) as {
        value: unknown;
        context: Record<string, unknown>;
      };
      const runOptions = {
        overrides: deserialized.context,
        parentSignal: workerSideAbortController.signal,
      };

      if (requestType === "stream_request") {
        // Handshake: Tell the main thread we are ready to stream.
        self.postMessage({ id, type: "stream_start", payload: null });
        await crossSerializeStream(
          run(targetTask, deserialized.value, runOptions),
          {
            scopeId: "worker",
            onSerialize: (chunk) => self.postMessage(chunk),
            onError: async (e) =>
              self.postMessage({
                id,
                type: "error",
                payload: await toJSONAsync(
                  e instanceof WorkflowError && e.cause ? e.cause : e,
                  { plugins: options.plugins },
                ),
              }),
            plugins: options.plugins,
          },
        );
      } else {
        const result = await run(targetTask, deserialized.value, runOptions);
        self.postMessage({
          id,
          type: "result",
          payload: await toJSONAsync(result, { plugins: options.plugins }),
        });
      }
    } catch (e) {
      self.postMessage({
        id,
        type: "error",
        payload: await toJSONAsync(
          e instanceof WorkflowError && e.cause ? e.cause : e,
          { plugins: options.plugins },
        ),
      });
    } finally {
      if (!workerSideAbortController.signal.aborted)
        workerSideAbortController.abort();
    }
  };
}

// --- Main-Thread Side Implementation ---
function ensureWorkerListener(
  worker: IsomorphicWorker,
  opOptions?: RunOnWorkerOptions,
) {
  if (workerPendingRequests.has(worker)) return;
  workerPendingRequests.set(worker, new Map());

  if (typeof (globalThis as any).$R !== "object") (globalThis as any).$R = {};
  if (!(globalThis as any).$R.worker) (globalThis as any).$R.worker = [];

  const messageHandler = (eventOrData: MessageEvent | any) => {
    const data = eventOrData.data ?? eventOrData;
    if (typeof data === "string") {
      try {
        eval(data);
      } catch (e) {
        console.error("Effectively stream eval error:", e);
      }
      return;
    }

    const { id, type, payload } = data as WorkerResponse;
    if (id === undefined) return;
    const pending = workerPendingRequests.get(worker)?.get(id);
    if (!pending) return;

    if (type === "stream_start") {
      pending.resolve(null); // Resolve the setup promise, but keep the request pending for final errors.
      return;
    }

    workerPendingRequests.get(worker)?.delete(id);
    pending.cleanup();
    try {
      const deserialized = fromJSON(payload, { plugins: opOptions?.plugins });
      type === "error"
        ? pending.reject(deserialized)
        : pending.resolve(deserialized);
    } catch (e) {
      pending.reject(e);
    }
  };

  const errorHandler = (e: ErrorEvent | Error) => {
    const err = "error" in e ? e.error : e;
    workerPendingRequests.get(worker)?.forEach((p) => {
      p.cleanup();
      p.reject(err);
    });
    workerPendingRequests.get(worker)?.clear();
  };

  "addEventListener" in worker
    ? (worker.addEventListener("message", messageHandler),
      worker.addEventListener("error", errorHandler))
    : ((worker as any).on("message", messageHandler),
      (worker as any).on("error", errorHandler));
}

export function runOnWorker<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, R> {
  return async (fullContext: C, value: V): Promise<R> => {
    ensureWorkerListener(worker, opOptions);
    const id = messageIdCounter++;
    const { scope, ...contextToSerialize } = fullContext;
    const cancellationBuffer = new SharedArrayBuffer(4);

    return new Promise<R>(async (resolve, reject) => {
      const onAbort = () =>
        Atomics.store(new Int32Array(cancellationBuffer), 0, 1);
      if (scope.signal.aborted) return reject(scope.signal.reason);
      const cleanup = () => scope.signal.removeEventListener("abort", onAbort);
      scope.signal.addEventListener("abort", onAbort, { once: true });

      workerPendingRequests.get(worker)!.set(id, { resolve, reject, cleanup });
      try {
        const payload = await toJSONAsync(
          { value, context: contextToSerialize },
          { plugins: opOptions?.plugins },
        );
        worker.postMessage({
          type: "request",
          id,
          taskId,
          payload,
          cancellationBuffer,
        });
      } catch (e) {
        reject(e);
        cleanup();
        workerPendingRequests.get(worker)!.delete(id);
      }
    });
  };
}

export function runStreamOnWorker<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, AsyncIterable<R>> {
  return async (fullContext: C, value: V): Promise<AsyncIterable<R>> => {
    ensureWorkerListener(worker, opOptions);
    const id = messageIdCounter++;
    const { scope, ...contextToSerialize } = fullContext;
    const cancellationBuffer = new SharedArrayBuffer(4);

    const payload = await toJSONAsync(
      { value, context: contextToSerialize },
      { plugins: opOptions?.plugins },
    );
    worker.postMessage({
      type: "stream_request",
      id,
      taskId,
      payload,
      cancellationBuffer,
    });

    // Wait for the 'stream_start' handshake from the worker
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => scope.signal.removeEventListener("abort", onAbort);
      const onAbort = () => {
        Atomics.store(new Int32Array(cancellationBuffer), 0, 1);
        reject(scope.signal.reason);
        cleanup();
      };
      if (scope.signal.aborted) return reject(scope.signal.reason);
      scope.signal.addEventListener("abort", onAbort, { once: true });
      // The resolve function here will be called by the `stream_start` message type
      workerPendingRequests.get(worker)!.set(id, {
        resolve: () => {
          cleanup();
          resolve();
        },
        reject,
        cleanup,
      });
    });

    return (async function* managedAsyncIterable(): AsyncIterable<R> {
      const streamProxy = createSerovalStream<R>();
      const iterable = streamToAsyncIterable(streamProxy);
      createReference(`Stream#${id}`, streamProxy);

      const onMainThreadCancel = () =>
        Atomics.store(new Int32Array(cancellationBuffer), 0, 1);
      scope.signal.addEventListener("abort", onMainThreadCancel, {
        once: true,
      });
      try {
        for await (const item of iterable) {
          if (scope.signal.aborted) throw scope.signal.reason;
          yield item;
        }
      } finally {
        scope.signal.removeEventListener("abort", onMainThreadCancel);
        if (Atomics.load(new Int32Array(cancellationBuffer), 0) === 0)
          onMainThreadCancel();
      }
    })();
  };
}
