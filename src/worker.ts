// File: src/worker.ts
import { createContext, type BaseContext, type Task } from "./run";
import {
  toJSON,
  toJSONAsync,
  fromJSON,
  getCrossReferenceHeader,
  createReference,
  createStream,
  type SerovalJSON,
  type Plugin as SerovalPlugin,
  type Stream as SerovalStream,
} from "seroval";

// --- Seroval Stream-to-Iterable Bridge (from documentation) ---
interface Deferred {
  promise: Promise<any>;
  resolve(value: any): void;
  reject(value: any): void;
}
function createDeferred(): Deferred {
  let resolve: (value: any) => void;
  let reject: (value: any) => void;
  const promise = new Promise<any>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve: resolve!, reject: reject! };
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
export interface StreamHandle<TNext, TReturn = void> {
  next(value: TNext): void;
  throw(error: unknown): void;
  return(value?: TReturn): void;
}
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
  type: "result" | "error";
  payload: SerovalJSON;
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
    if (!taskId || !tasks[taskId]) {
      const errorPayload = await toJSONAsync(
        new ReferenceError(`Task "${taskId}" not found on worker.`),
      );
      self.postMessage({ id, type: "error", payload: errorPayload });
      return;
    }
    const workerSideAbortController = new AbortController();
    if (cancellationBuffer) {
      const cancellationView = new Int32Array(cancellationBuffer);
      const pollCancellation = () => {
        if (Atomics.load(cancellationView, 0) === 1) {
          workerSideAbortController.abort(
            new DOMException("Aborted by main thread", "AbortError"),
          );
        } else if (!workerSideAbortController.signal.aborted) {
          setTimeout(pollCancellation, 50);
        }
      };
      pollCancellation();
    }
    try {
      const deserialized = fromJSON(payload, { plugins: options.plugins }) as {
        value: unknown;
        context: Record<string, unknown>;
        stream?: StreamHandle<any, any>;
      };
      const runOptions = {
        overrides: { ...deserialized.context, stream: deserialized.stream },
        parentSignal: workerSideAbortController.signal,
      };
      const result = await run(tasks[taskId], deserialized.value, runOptions);
      if (requestType !== "stream_request") {
        const serializationResult = await toJSONAsync(result, {
          plugins: options.plugins,
        });
        self.postMessage({ id, type: "result", payload: serializationResult });
      }
    } catch (executionError) {
      const serializedError = await toJSONAsync(executionError, {
        plugins: options.plugins,
      });
      self.postMessage({ id, type: "error", payload: serializedError });
    } finally {
      if (!workerSideAbortController.signal.aborted) {
        workerSideAbortController.abort();
      }
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
  const messageHandler = (eventOrData: MessageEvent | any) => {
    const data = eventOrData.data ?? eventOrData;
    if (typeof data === "string") {
      try {
        eval(data);
      } catch (e) {
        console.error("Effectively worker: Error evaluating stream chunk:", e);
      }
      return;
    }
    const { id, type, payload } = data as WorkerResponse;
    const pending = workerPendingRequests.get(worker)?.get(id);
    if (!pending) return;
    workerPendingRequests.get(worker)?.delete(id);
    pending.cleanup();
    try {
      const deserialized = fromJSON(payload, { plugins: opOptions?.plugins });
      if (type === "error") {
        pending.reject(deserialized);
      } else {
        pending.resolve(deserialized);
      }
    } catch (e) {
      pending.reject(e);
    }
  };
  const errorHandler = (eventOrError: ErrorEvent | Error) => {
    const error =
      eventOrError instanceof Error ? eventOrError : eventOrError.error;
    const pendingMap = workerPendingRequests.get(worker);
    if (pendingMap) {
      pendingMap.forEach((pending) => {
        pending.cleanup();
        pending.reject(error || new Error("Unknown worker error"));
      });
      pendingMap.clear();
    }
  };
  if (
    "addEventListener" in worker &&
    typeof worker.addEventListener === "function"
  ) {
    worker.addEventListener("message", messageHandler);
    worker.addEventListener("error", errorHandler);
  } else {
    const nodeWorker = worker as unknown as { on: Function };
    nodeWorker.on("message", messageHandler);
    nodeWorker.on("error", errorHandler);
  }
}

export function runOnWorker<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, R> {
  const workerTaskLogic: Task<C, V, R> = (
    fullContext: C,
    value: V,
  ): Promise<R> => {
    ensureWorkerListener(worker, opOptions);
    const id = messageIdCounter++;
    const { scope, ...contextToSerialize } = fullContext;
    const cancellationBuffer = new SharedArrayBuffer(4);
    return new Promise<R>(async (resolve, reject) => {
      const onMainThreadCancel = () => {
        const view = new Int32Array(cancellationBuffer);
        Atomics.store(view, 0, 1);
        Atomics.notify(view, 0);
      };
      if (scope.signal.aborted) {
        return reject(
          scope.signal.reason ??
            new DOMException("Operation aborted before dispatch", "AbortError"),
        );
      }
      const cleanup = () =>
        scope.signal.removeEventListener("abort", onMainThreadCancel);
      scope.signal.addEventListener("abort", onMainThreadCancel, {
        once: true,
      });
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
  Object.defineProperty(workerTaskLogic, "name", {
    value: `runOnWorker(${taskId})`,
  });
  return workerTaskLogic;
}

export function runStreamOnWorker<C extends BaseContext, V, R>(
  worker: IsomorphicWorker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, AsyncIterable<R>> {
  const streamWorkerTaskLogic: Task<C, V, AsyncIterable<R>> = (
    fullContext: C,
    value: V,
  ): Promise<AsyncIterable<R>> => {
    ensureWorkerListener(worker, opOptions);
    return new Promise<AsyncIterable<R>>(async (resolve, reject) => {
      try {
        const id = messageIdCounter++;
        const { scope, ...contextToSerialize } = fullContext;
        const cancellationBuffer = new SharedArrayBuffer(4);
        const streamProxy = createStream<R>();

        // This promise ONLY tracks if the worker sends back an immediate, one-off error.
        const setupErrorPromise = new Promise<void>((_, setupReject) => {
          const onMainThreadCancel = () => {
            const view = new Int32Array(cancellationBuffer);
            Atomics.store(view, 0, 1);
            Atomics.notify(view, 0);
            setupReject(
              scope.signal.reason ??
                new DOMException("Stream aborted by context", "AbortError"),
            );
          };
          if (scope.signal.aborted) {
            return setupReject(
              scope.signal.reason ??
                new DOMException(
                  "Stream aborted before creation",
                  "AbortError",
                ),
            );
          }
          const cleanup = () =>
            scope.signal.removeEventListener("abort", onMainThreadCancel);
          scope.signal.addEventListener("abort", onMainThreadCancel, {
            once: true,
          });
          workerPendingRequests
            .get(worker)!
            .set(id, { resolve: () => {}, reject: setupReject, cleanup });
        });

        setupErrorPromise.catch((err) => streamProxy.throw(err));

        const iterable = streamToAsyncIterable(streamProxy);

        const payload = toJSON(
          { value, context: contextToSerialize, stream: streamProxy },
          { plugins: opOptions?.plugins },
        );
        worker.postMessage({
          type: "stream_request",
          id,
          taskId,
          payload,
          cancellationBuffer,
        });

        resolve(iterable);
      } catch (e) {
        reject(e);
      }
    });
  };
  Object.defineProperty(streamWorkerTaskLogic, "name", {
    value: `runStreamOnWorker(${taskId})`,
  });
  return streamWorkerTaskLogic;
}
