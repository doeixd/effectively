/**
 * @module WebWorkerUtils
 * This module provides seamless integration with native Web Workers, enabling
 * computationally expensive or I/O-bound tasks to be offloaded from the main thread.
 * It multiplexes concurrent requests and supports both request-response and streaming patterns.
 */
import { createContext, type BaseContext, type Task } from "./run";

import {
  crossSerializeAsync,
  fromJSON,
  getCrossReferenceHeader,
  createReference,
  createStream,
  type SerovalJSON,
  type Plugin as SerovalPlugin,
} from "seroval";

// --- Type Definitions ---
export interface StreamHandle<TNext, TReturn = void> {
  next: (value: TNext) => void;
  throw: (error: unknown) => void;
  return: (value?: TReturn) => void;
}

interface WorkerHandlerOptions {
  references?: Record<string, unknown>;
  plugins?: SerovalPlugin<any, any>[];
}

export interface RunOnWorkerOptions {
  plugins?: SerovalPlugin<any, any>[];
}

// --- Communication Protocol Types ---
interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason?: any) => void;
  cleanup: () => void;
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
  globalThis.Worker,
  Map<number, PendingRequest>
>();
let messageIdCounter = 0;

// --- Worker-Side Implementation ---
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

  self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
    const { id, taskId, payload, cancellationBuffer } = event.data;

    if (!taskId || !tasks[taskId]) {
      const errorPayload = await crossSerializeAsync(
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
      const deserialized = fromJSON(payload!, { plugins: options.plugins }) as {
        value: unknown;
        context: Record<string, unknown>;
        stream?: any;
      };
      const runOptions = {
        overrides: deserialized.context,
        parentSignal: workerSideAbortController.signal,
      };

      const result = await run(tasks[taskId], deserialized.value, runOptions);

      const serializedResult = await crossSerializeAsync(result, {
        scopeId: "worker",
        plugins: options.plugins,
        onSerialize: (chunk: string) => self.postMessage(chunk), // Critical for streams
      });
      self.postMessage({ id, type: "result", payload: serializedResult });
    } catch (executionError) {
      const serializedError = await crossSerializeAsync(executionError, {
        scopeId: "worker",
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
  worker: globalThis.Worker,
  opOptions?: RunOnWorkerOptions,
) {
  if (workerPendingRequests.has(worker)) return;

  workerPendingRequests.set(worker, new Map());
  worker.onmessage = (event: MessageEvent<WorkerResponse | string>) => {
    if (typeof event.data === "string") {
      try {
        // eslint-disable-next-line no-eval
        eval(event.data);
      } catch (e) {
        console.error("Effectively worker: Error evaluating stream chunk:", e);
      }
      return;
    }

    const { id, type, payload } = event.data;
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
  worker.onerror = (event: ErrorEvent) => {
    const pendingMap = workerPendingRequests.get(worker);
    if (pendingMap) {
      pendingMap.forEach((pending) => {
        pending.cleanup();
        pending.reject(
          event.error || new Error(event.message || "Unknown worker error"),
        );
      });
      pendingMap.clear();
    }
  };
}

export function runOnWorker<C extends BaseContext, V, R>(
  worker: globalThis.Worker,
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
        const payload = await crossSerializeAsync(
          { value, context: contextToSerialize },
          { scopeId: "main", plugins: opOptions?.plugins },
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
  worker: globalThis.Worker,
  taskId: string,
  opOptions?: RunOnWorkerOptions,
): Task<C, V, AsyncIterable<R>> {
  const streamWorkerTaskLogic: Task<C, V, AsyncIterable<R>> = async (
    fullContext: C,
    value: V,
  ): Promise<AsyncIterable<R>> => {
    ensureWorkerListener(worker, opOptions);

    const id = messageIdCounter++;
    const { scope, ...contextToSerialize } = fullContext;
    const cancellationBuffer = new SharedArrayBuffer(4);

    const setupPromise = new Promise<any>(async (resolve, reject) => {
      const onMainThreadCancel = () => {
        const view = new Int32Array(cancellationBuffer);
        Atomics.store(view, 0, 1);
        Atomics.notify(view, 0);
      };

      if (scope.signal.aborted) {
        return reject(
          scope.signal.reason ??
            new DOMException("Stream aborted before creation", "AbortError"),
        );
      }
      const cleanup = () =>
        scope.signal.removeEventListener("abort", onMainThreadCancel);
      scope.signal.addEventListener("abort", onMainThreadCancel, {
        once: true,
      });

      workerPendingRequests.get(worker)!.set(id, { resolve, reject, cleanup });

      try {
        // Here, we don't pass a real streamProxy. The worker will create it and seroval
        // will send back the string chunks to drive it on the main thread.
        const payload = await crossSerializeAsync(
          { value, context: contextToSerialize },
          { scopeId: "main", plugins: opOptions?.plugins },
        );
        worker.postMessage({
          type: "stream_request",
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

    // The result of the setup promise is the iterable itself, created by seroval's magic.
    const iterable = await setupPromise;
    if (typeof iterable?.[Symbol.asyncIterator] !== "function") {
      throw new TypeError(
        "Worker did not return an AsyncIterable for a streaming task.",
      );
    }

    return (async function* managedAsyncIterable(): AsyncIterable<R> {
      try {
        for await (const item of iterable) {
          if (scope.signal.aborted) {
            throw (
              scope.signal.reason ??
              new DOMException("Stream consumption aborted", "AbortError")
            );
          }
          yield item;
        }
      } finally {
        const view = new Int32Array(cancellationBuffer);
        if (Atomics.load(view, 0) === 0) {
          Atomics.store(view, 0, 1);
          Atomics.notify(view, 0);
        }
      }
    })();
  };

  Object.defineProperty(streamWorkerTaskLogic, "name", {
    value: `runStreamOnWorker(${taskId})`,
  });
  return streamWorkerTaskLogic;
}
