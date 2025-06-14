// File: test/manual-worker.ts
import {
  createContext,
  run,
  type BaseContext,
  type WorkflowError,
} from "../src/index";
import {
  runOnWorker,
  runStreamOnWorker,
  type RunOnWorkerOptions,
} from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";
import { Worker } from "node:worker_threads";
import { URL } from "node:url";

async function main() {
  console.log("--- Starting Manual Worker Test Runner ---");
  const { run: testRun } = createContext<BaseContext>({});
  const serovalOptions: RunOnWorkerOptions = { plugins: [DOMExceptionPlugin] };

  const workerUrl = new URL("./manual-test.worker.js", import.meta.url);
  const worker = new Worker(workerUrl);
  console.log("✅ Main: Worker created.");

  // SCENARIO 1: Successful Request-Response
  console.log("\n--- SCENARIO 1: Testing successful `runOnWorker` ---");
  try {
    const remoteHeavyTask = runOnWorker(worker, "heavyTask", serovalOptions);
    const result = await testRun(remoteHeavyTask, { value: 21 });
    console.log(`✅ Main: Received successful result: ${result}`);
    if (result !== 42)
      throw new Error("Assertion failed! Expected 42, got " + result);
  } catch (e) {
    console.error("❌ Main: Scenario 1 failed unexpectedly:", e);
  }

  // SCENARIO 2: Error Propagation
  console.log("\n--- SCENARIO 2: Testing error propagation from worker ---");
  try {
    const remoteFailingTask = runOnWorker(
      worker,
      "failingTask",
      serovalOptions,
    );
    await testRun(remoteFailingTask, null);
  } catch (e: any) {
    const errorMessage = e.message;
    console.log(
      `✅ Main: Correctly caught error from worker. Message: "${errorMessage}"`,
    );
    if (!errorMessage.includes("Worker task failed deliberately")) {
      throw new Error(
        `Assertion failed! Expected message to contain "Worker task failed deliberately", got "${errorMessage}"`,
      );
    }
  }

  // SCENARIO 3: Cancellation
  console.log("\n--- SCENARIO 3: Testing cancellation of worker task ---");
  try {
    const controller = new AbortController();
    const remoteCancellableTask = runOnWorker(
      worker,
      "heavyTask",
      serovalOptions,
    );
    const promise = testRun(
      remoteCancellableTask,
      { value: 99 },
      { parentSignal: controller.signal },
    );
    setTimeout(() => {
      console.log("...[Main] Aborting task...");
      controller.abort();
    }, 80);
    await promise;
  } catch (e: any) {
    const errorMessage = e.message;
    console.log(
      `✅ Main: Correctly caught cancellation error. Message: "${errorMessage}"`,
    );
    if (!errorMessage.includes("Heavy task aborted by main thread")) {
      throw new Error(
        `Assertion failed! Expected message to contain "Heavy task aborted by main thread", got "${errorMessage}"`,
      );
    }
  }

  // SCENARIO 4: Successful Streaming
  console.log("\n--- SCENARIO 4: Testing successful `runStreamOnWorker` ---");
  try {
    const remoteStream = runStreamOnWorker<any, number, string>(
      worker,
      "streamingTask",
      serovalOptions,
    );
    const iterable = await testRun(remoteStream, 3);
    console.log(
      "✅ [Runner] Got iterable immediately, now starting 'for await' loop...",
    );
    const results: string[] = [];
    // <<< DEBUG LOG >>>
    console.log(
      ">>> [DEBUG] Main thread is about to enter the for-await loop.",
    );
    for await (const value of iterable) {
      // <<< DEBUG LOG >>>
      console.log(
        `>>> [DEBUG] Main thread received value from iterable: "${value}"`,
      );
      results.push(value);
    }
    console.log("✅ [Runner] 'for await' loop finished.");
    if (
      JSON.stringify(results) !==
      JSON.stringify(["Update #1", "Update #2", "Update #3"])
    ) {
      throw new Error("Assertion failed! Stream results incorrect.");
    }
    console.log("✅ Main: Stream consumed successfully.");
  } catch (e) {
    console.error("❌ Main: Scenario 4 failed unexpectedly:", e);
  }

  // --- Teardown ---
  console.log("\n--- All scenarios complete. Terminating worker. ---");
  await worker.terminate();
  console.log("✅ Main: Worker terminated.");
}

main().catch(console.error);
