// File: test/manual-worker.ts
import {
  createContext,
  WorkflowError,
  type BaseContext,
  createWorkerProxy, // Import the new proxy function
  runOnWorker,
  runStreamOnWorker,
  type WorkerOptions,
} from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";
import { Worker } from "node:worker_threads";
import { URL } from "node:url";

// This type-only import is crucial for `createWorkerProxy` to be type-safe.
import { type tasks } from "./manual-test-tasks";


async function main() {
  console.log("--- Starting Manual Worker Test Runner ---");
  const { run: testRun } = createContext<BaseContext>({});
  const serovalOptions: WorkerOptions = { plugins: [DOMExceptionPlugin] };

  const workerUrl = new URL("./manual-test.worker.js", import.meta.url);
  const worker = new Worker(workerUrl);
  console.log("✅ Main: Worker created.");

  // Wait for the worker to be ready before proceeding.
  // A robust proxy implementation would handle this, but for manual tests, a simple wait is fine.
  await new Promise(resolve => worker.once('online', resolve));


  // =================================================================
  // Section A: Core API Tests (runOnWorker / runStreamOnWorker)
  // =================================================================
  console.log("\n\n-- SECTION A: CORE API (runOnWorker / runStreamOnWorker) --");

  // SCENARIO 1: Successful Request-Response
  console.log("\n--- SCENARIO 1: Testing successful `runOnWorker` ---");
  try {
    const remoteHeavyTask = runOnWorker(worker, "heavyTask", serovalOptions);
    const result = await testRun(remoteHeavyTask, { value: 21 });
    console.log(`✅ Main: Received successful result: ${result}`);
    if (result !== 42) throw new Error("Assertion failed! Expected 42, got " + result);
  } catch (e) {
    console.error("❌ Main: Scenario 1 failed unexpectedly:", e);
    process.exit(1);
  }

  // SCENARIO 2: Error Propagation
  console.log("\n--- SCENARIO 2: Testing error propagation from worker ---");
  try {
    const remoteFailingTask = runOnWorker(worker, "failingTask", serovalOptions);
    await testRun(remoteFailingTask, null);
  } catch (e: any) {
    const errorMessage = e.message;
    console.log(`✅ Main: Correctly caught error from worker. Message: "${errorMessage}"`);
    if (!errorMessage.includes("Worker task failed deliberately")) {
      throw new Error(`Assertion failed! Expected message to contain "Worker task failed deliberately", got "${errorMessage}"`);
    }
  }

  // SCENARIO 3: Cancellation
  console.log("\n--- SCENARIO 3: Testing cancellation of worker task ---");
  try {
    const controller = new AbortController();
    const remoteCancellableTask = runOnWorker(worker, "heavyTask", serovalOptions);
    const promise = testRun(remoteCancellableTask, { value: 99 }, { parentSignal: controller.signal });
    setTimeout(() => {
      console.log("...[Main] Aborting task...");
      controller.abort();
    }, 80);
    await promise;
  } catch (e: any) {
    const errorMessage = e.message;
    console.log(`✅ Main: Correctly caught cancellation error. Message: "${errorMessage}"`);
    if (!errorMessage.includes("Heavy task aborted by main thread")) {
      throw new Error(`Assertion failed! Expected message to contain "Heavy task aborted by main thread", got "${errorMessage}"`);
    }
  }

  // SCENARIO 4: Successful Streaming
  console.log("\n--- SCENARIO 4: Testing successful `runStreamOnWorker` ---");
  try {
    const remoteStream = runStreamOnWorker<any, number, string>(worker, "streamingTask", serovalOptions);
    const iterable = await testRun(remoteStream, 3);
    console.log("✅ [Runner] Got iterable immediately, now starting 'for await' loop...");
    const results: string[] = [];
    for await (const value of iterable) {
      console.log(`   [Main] Received stream value: "${value}"`);
      results.push(value);
    }
    console.log("✅ [Runner] 'for await' loop finished.");
    if (JSON.stringify(results) !== JSON.stringify(["Update #1", "Update #2", "Update #3"])) {
      throw new Error("Assertion failed! Stream results incorrect.");
    }
    console.log("✅ Main: Stream consumed successfully.");
  } catch (e) {
    console.error("❌ Main: Scenario 4 failed unexpectedly:", e);
    process.exit(1);
  }

  // SCENARIO 5: Failing Stream
  console.log("\n--- SCENARIO 5: Testing failing stream ---");
  try {
    const remoteFailingStream = runStreamOnWorker<any, void, string>(worker, "failingStreamTask", serovalOptions);
    const iterable = await testRun(remoteFailingStream, undefined);
    for await (const value of iterable) {
      console.log(`   [Main] Received value from failing stream: "${value}"`); // Should not happen
    }
  } catch (e: any) {
    const cause = e instanceof WorkflowError ? e.cause : e;
    console.log(`✅ Main: Correctly caught failing stream error. Message: "${cause.message}"`);
    if (!cause.message.includes("Stream blew up")) throw new Error("Assertion failed!");
  }

  // SCENARIO 6: Main Thread Cancellation of Stream
  console.log("\n--- SCENARIO 6: Testing main-thread cancellation during streaming ---");
  try {
    const controller = new AbortController();
    const remoteStream = runStreamOnWorker<any, number, string>(worker, "streamingTask", serovalOptions);
    const iterable = await testRun(remoteStream, 5, { parentSignal: controller.signal });
    const iterator = iterable[Symbol.asyncIterator]();

    let first = await iterator.next();
    console.log(`   [Main] Received first value: "${first.value}"`);

    console.log("...[Main] Aborting stream via controller...");
    controller.abort(new Error("Stream cancelled by user"));

    await iterator.next(); // This should reject
  } catch (e: any) {
    const cause = e instanceof WorkflowError ? e.cause : e;
    console.log(`✅ Main: Correctly caught stream cancellation. Message: "${cause.message}"`);
    if (!cause.message.includes("Stream cancelled by user")) {
      throw new Error("Assertion failed! Unexpected cancellation reason.");
    }
  }

  // SCENARIO 7: Consumer Early Termination (break)
  console.log("\n--- SCENARIO 7: Testing consumer early loop termination (`break`) ---");
  try {
    const remoteStream = runStreamOnWorker<any, number, string>(worker, "streamingTask", serovalOptions);
    const iterable = await testRun(remoteStream, 5);
    const results: string[] = [];
    let error: any = null;

    console.log("...[Main] Entering loop, will break after 2 items...");
    for await (const value of iterable) {
      console.log(`   [Main] Received value: "${value}"`);
      results.push(value);
      if (results.length === 2) {
        break; // <-- The important part
      }
    }

    console.log("✅ Main: Loop successfully broken.");
    if (results.length !== 2 || results[1] !== "Update #2") {
      throw new Error("Assertion Failed! Loop did not collect correct items before break.");
    }
    if (error) {
      throw new Error("Assertion Failed! Breaking the loop should not cause an error.");
    }
    console.log("✅ Main: Early loop termination handled gracefully.");
  } catch (e) {
    console.error("❌ Main: Scenario 7 failed unexpectedly:", e);
    process.exit(1);
  }
  
  ;((async () =>{
  console.log("\n--- Section A complete. Terminating original worker. ---");
  await worker.terminate();
  console.log("✅ Main: Original worker terminated.");
  })());


  // =================================================================
  // Section B: Proxy API Tests (createWorkerProxy)
  // =================================================================
  console.log("\n\n-- SECTION B: PROXY API (createWorkerProxy) --");

  // Create a new worker for the proxy tests to ensure a clean state
  let proxyWorker = new Worker(workerUrl);
    await new Promise(resolve => proxyWorker.once('online', resolve))

  try {
    console.log("...[Main] Creating worker proxy. Waiting for it to resolve...");
    // Note: The `await` is crucial as `createWorkerProxy` is async.
    const remote = await createWorkerProxy<typeof tasks>(proxyWorker, {
      plugins: [DOMExceptionPlugin],
    });
    console.log("✅ Main: Worker proxy resolved.");

    // SCENARIO 8: Successful request-response via Proxy
    console.log("\n--- SCENARIO 8: Testing successful request-response via proxy ---");
    const proxyResult = await testRun(remote.heavyTask, { value: 50 });
    console.log(`✅ Main: Received successful proxy result: ${proxyResult}`);
    if (proxyResult !== 100) throw new Error("Assertion failed! Expected 100.");

    // SCENARIO 9: Successful streaming via Proxy
    console.log("\n--- SCENARIO 9: Testing successful streaming via proxy ---");
    const proxyIterable = await testRun(remote.streamingTask, 2);
    const proxyStreamResults: string[] = [];
    for await (const value of proxyIterable) {
      console.log(`   [Main] Received proxy stream value: "${value}"`);
      proxyStreamResults.push(value);
    }
    if (JSON.stringify(proxyStreamResults) !== JSON.stringify(["Update #1", "Update #2"])) {
      throw new Error("Assertion failed! Proxy stream results incorrect.");
    }
    console.log("✅ Main: Proxy stream consumed successfully.");

  } catch (e) {
    console.error("❌ Main: Proxy tests failed unexpectedly:", e);
    process.exit(1);
  } finally {
    console.log("\n--- Proxy tests complete. Terminating proxy worker. ---");
    await proxyWorker.terminate();
    console.log("✅ Main: Proxy worker terminated.");
  }

  // --- Final Teardown ---
  console.log("\n--- All scenarios complete. Terminating original worker. ---");
  await worker.terminate();
  console.log("✅ Main: Original worker terminated.");
}

main().catch(e => {
  console.error("\n💥 A CRITICAL ERROR OCCURRED IN THE TEST RUNNER 💥");
  console.error(e);
  process.exit(1);
});