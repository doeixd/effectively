// test/worker.test.ts

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  createContext,
  defineTask,
  run,
  type BaseContext,
  getContext,
} from "../src/run";
import {
  createWorkerHandler,
  runOnWorker,
  runStreamOnWorker,
  type StreamHandle,
} from "../src/worker";
import { DOMExceptionPlugin } from "seroval-plugins/web";

// --- 1. Mock Worker Environment ---

class MockMessagePort {
  onmessage: ((event: MessageEvent) => void) | null = null;
  otherPort: MockMessagePort | null = null;

  postMessage(data: any): void {
    if (this.otherPort?.onmessage) {
      queueMicrotask(() => {
        this.otherPort!.onmessage!(new MessageEvent("message", { data }));
      });
    }
  }
}

// Define an interface for the worker-side message handler
interface MockWorkerInterface {
  postMessage: (data: any) => void;
  onmessage: ((event: MessageEvent<any>) => void) | null;
  self: MockWorkerInterface;
}

class MockWorker {
  mainThreadPort = new MockMessagePort();
  workerThreadPort = new MockMessagePort();

  constructor() {
    this.mainThreadPort.otherPort = this.workerThreadPort;
    this.workerThreadPort.otherPort = this.mainThreadPort;
  }

  postMessage(data: any): void {
    this.mainThreadPort.postMessage(data);
  }

  set onmessage(handler: ((event: MessageEvent) => void) | null) {
    this.mainThreadPort.onmessage = handler;
  }

  // Correctly typed worker-side interface
  get worker(): MockWorkerInterface {
    const workerPort = this.workerThreadPort; // Capture the correct port
    const workerInterface = {
      postMessage: (data: any) => workerPort.postMessage(data),
      set onmessage(handler: ((event: MessageEvent<any>) => void) | null) {
        workerPort.onmessage = handler;
      },
      // self refers to the interface object itself
      get self(): MockWorkerInterface {
        return workerInterface;
      },
    };
    return workerInterface;
  }

  terminate(): void {
    // No-op
  }
}

const heavyTask = defineTask(async (data: { value: number }) => {
  const context = getContext<BaseContext>();
  for (let i = 0; i < 100; i++) {
    if (context.scope.signal.aborted) {
      throw new DOMException("Heavy task aborted", "AbortError");
    }
  }
  return data.value * 2;
});

const failingTask = defineTask(async () => {
  throw new Error("Worker task failed deliberately");
});

interface StreamingTaskContext extends BaseContext {
  stream: StreamHandle<string, void>;
}

const streamingTask = defineTask(async (count: number) => {
  const context = getContext<StreamingTaskContext>();
  for (let i = 1; i <= count; i++) {
    if (context.scope.signal.aborted) {
      context.stream.throw(
        new DOMException("Stream aborted by worker", "AbortError"),
      );
      return;
    }
    context.stream.next(`Update ${i}/${count}`);
  }
  context.stream.return();
});

// --- Test Suite ---

describe("Web Worker Utilities (worker.ts)", () => {
  let mockWorker: MockWorker;
  const { run: testRun } = createContext<BaseContext>({});

  beforeEach(() => {
    mockWorker = new MockWorker();
    global.self = mockWorker.worker.self as any;
    createWorkerHandler(
      { heavyTask, failingTask, streamingTask },
      { plugins: [DOMExceptionPlugin] },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("runOnWorker (Request-Response)", () => {
    it("should successfully execute a task on the worker and return the result", async () => {
      const remoteTask = runOnWorker(mockWorker as any, "heavyTask", {
        plugins: [DOMExceptionPlugin],
      });
      const result = await testRun(remoteTask, { value: 21 });
      expect(result).toBe(42);
    });

    it("should correctly propagate an error from the worker task", async () => {
      const remoteTask = runOnWorker(mockWorker as any, "failingTask", {
        plugins: [DOMExceptionPlugin],
      });
      await expect(testRun(remoteTask, null)).rejects.toThrow(
        "Worker task failed deliberately",
      );
    });

    it("should reject if the taskId is not found on the worker", async () => {
      const remoteTask = runOnWorker(mockWorker as any, "nonExistentTask");
      await expect(testRun(remoteTask, null)).rejects.toThrow(
        'Task "nonExistentTask" not found on worker',
      );
    });

    it("should handle cancellation from the main thread", async () => {
      const controller = new AbortController();
      const remoteTask = runOnWorker(mockWorker as any, "heavyTask");

      const promise = testRun(
        remoteTask,
        { value: 10 },
        { parentSignal: controller.signal },
      );

      controller.abort();

      await expect(promise).rejects.toThrow("Operation aborted by main thread");
    });
  });

  describe("runStreamOnWorker (Streaming)", () => {
    it("should stream all results successfully from the worker", async () => {
      const remoteStream = runStreamOnWorker<any, any, string>(
        mockWorker as any,
        "streamingTask",
        { plugins: [DOMExceptionPlugin] },
      );
      const iterable = await testRun(remoteStream, 3);

      const results: string[] = [];
      for await (const value of iterable) {
        results.push(value);
      }

      expect(results).toEqual(["Update 1/3", "Update 2/3", "Update 3/3"]);
    });

    it("should propagate an error thrown from the worker stream", async () => {
      const failingStreamTask = defineTask(async () => {
        const context = getContext<StreamingTaskContext>();
        context.stream.next("First value");
        context.stream.throw(new Error("Stream blew up"));
      });

      createWorkerHandler(
        { failingStreamTask },
        { plugins: [DOMExceptionPlugin] },
      );

      const remoteStream = runStreamOnWorker<any, any, string>(
        mockWorker as any,
        "failingStreamTask",
      );
      const iterable = await testRun(remoteStream, null);

      const results: string[] = [];
      await expect(async () => {
        for await (const value of iterable) {
          results.push(value);
        }
      }).rejects.toThrow("Stream blew up");

      expect(results).toEqual(["First value"]);
    });

    it("should handle cancellation from the main thread during streaming", async () => {
      const controller = new AbortController();
      const remoteStream = runStreamOnWorker(
        mockWorker as any,
        "streamingTask",
      );
      const iterable = await testRun(remoteStream, 5, {
        parentSignal: controller.signal,
      });

      const iterator = iterable[Symbol.asyncIterator]();

      expect(await iterator.next()).toEqual({
        value: "Update 1/5",
        done: false,
      });
      expect(await iterator.next()).toEqual({
        value: "Update 2/5",
        done: false,
      });

      controller.abort();

      await expect(iterator.next()).rejects.toThrow("Stream aborted by worker");
    });

    it("should handle the consumer breaking the loop early", async () => {
      const remoteStream = runStreamOnWorker<any, any, string>(
        mockWorker as any,
        "streamingTask",
      );
      const iterable = await testRun(remoteStream, 5);

      const results: string[] = [];
      for await (const value of iterable) {
        results.push(value);
        if (results.length === 2) {
          break;
        }
      }

      expect(results).toEqual(["Update 1/5", "Update 2/5"]);
    });
  });
});
