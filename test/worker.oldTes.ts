import "@vitest/web-worker";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createContext, run, type BaseContext } from "../src/run";
import {
  runOnWorker,
  runStreamOnWorker,
  type RunOnWorkerOptions,
} from "../src/worker";
import { DOMExceptionPlugin } from "seroval-plugins/web";
import { Worker } from "node:worker_threads";
import { URL } from "node:url";
// import MyWorker from "./test.worker?worker";

describe("Web Worker Utilities (worker.ts)", () => {
  let worker: Worker;
  const { run: testRun } = createContext<BaseContext>({});
  const serovalOptions: RunOnWorkerOptions = { plugins: [DOMExceptionPlugin] };

  beforeEach(() => {
    worker = new Worker(new URL("./test.worker.js?worker", import.meta.url));
    console.log(worker);
    // worker = new MyWorker();
  });

  afterEach(async () => {
    await worker.terminate();
  });

  describe("runOnWorker (Request-Response)", () => {
    it("should successfully execute a task on the worker and return the result", async () => {
      const remoteTask = runOnWorker(
        worker as any,
        "heavyTask",
        serovalOptions,
      );
      const result = await testRun(remoteTask, { value: 21 });
      expect(result).toBe(42);
    });

    it("should correctly propagate an error from the worker task", async () => {
      const remoteTask = runOnWorker(
        worker as any,
        "failingTask",
        serovalOptions,
      );
      await expect(testRun(remoteTask, null)).rejects.toThrow(
        "Worker task failed deliberately",
      );
    });

    it("should reject if the taskId is not found on the worker", async () => {
      const remoteTask = runOnWorker(
        worker as any,
        "nonExistentTask",
        serovalOptions,
      );
      await expect(testRun(remoteTask, null)).rejects.toThrow(
        'Task "nonExistentTask" not found on worker',
      );
    });

    it("should handle cancellation from the main thread", async () => {
      const controller = new AbortController();
      const remoteTask = runOnWorker(
        worker as any,
        "heavyTask",
        serovalOptions,
      );
      const promise = testRun(
        remoteTask,
        { value: 10 },
        { parentSignal: controller.signal },
      );

      setTimeout(() => controller.abort(new Error("User cancelled")), 2);

      await expect(promise).rejects.toThrow("User cancelled");
    });
  });

  describe("runStreamOnWorker (Streaming)", () => {
    it("should stream all results successfully from the worker", async () => {
      const remoteStream = runStreamOnWorker<any, number, string>(
        worker as any,
        "streamingTask",
        serovalOptions,
      );
      const iterable = await testRun(remoteStream, 3);
      const results: string[] = [];
      for await (const value of iterable) {
        results.push(value);
      }
      expect(results).toEqual(["Update 1/3", "Update 2/3", "Update 3/3"]);
    });

    it("should propagate an error thrown from the worker stream", async () => {
      const remoteStream = runStreamOnWorker<any, any, string>(
        worker as any,
        "failingStreamTask",
        serovalOptions,
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
      const remoteStream = runStreamOnWorker<any, number, string>(
        worker as any,
        "streamingTask",
        serovalOptions,
      );
      const iterable = await testRun(remoteStream, 5, {
        parentSignal: controller.signal,
      });
      const iterator = iterable[Symbol.asyncIterator]();

      const first = await iterator.next();
      expect(first.value).toBe("Update 1/5");

      controller.abort(new Error("Stream cancelled by user"));

      await expect(iterator.next()).rejects.toThrow("Stream cancelled by user");
    });

    it("should handle the consumer breaking the loop early", async () => {
      const remoteStream = runStreamOnWorker<any, number, string>(
        worker as any,
        "streamingTask",
        serovalOptions,
      );
      const iterable = await testRun(remoteStream, 5);
      const results: string[] = [];
      let error: any = null;
      try {
        for await (const value of iterable) {
          results.push(value);
          if (results.length === 2) {
            break;
          }
        }
      } catch (e) {
        error = e;
      }
      expect(results).toEqual(["Update 1/5", "Update 2/5"]);
      expect(error).toBeNull();
    });
  });
});
