// test/manual-worker.ts
import { createContext, run, type BaseContext, WorkflowError } from "../src/index";
import { runOnWorker, runStreamOnWorker, type IsomorphicWorker, type WorkerOptions } from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";
import { Worker } from "node:worker_threads";
import { URL } from "node:url";

function createReadyWorker(url: URL): Promise<IsomorphicWorker> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(url,  {  eval: true });
    const readyListener = (message: any) => {
      if (message && message.type === 'ready') {
        console.log("[Main] Received 'ready' signal from worker.");
        worker.off("message", readyListener);
        resolve(worker);
      }
    };
    worker.on("message", readyListener);
    worker.on("error", (err) => reject(err));
    worker.on("exit", (code) => { if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`)); });
  });
}

async function main() {
  console.log("--- Starting Manual Worker Test Runner ---");
  const workerUrl = new URL("./manual-test.worker.js", import.meta.url);
  const worker = await createReadyWorker(workerUrl);
  console.log("✅ Main: Worker setup complete.");

  const { run: testRun } = createContext<BaseContext>({});
  const workerOptions: WorkerOptions = { plugins: [DOMExceptionPlugin] };

  // SCENARIO 1
  console.log("\n--- SCENARIO 1: Testing successful `runOnWorker` ---");
  const remoteHeavyTask = runOnWorker(worker, "heavyTask", workerOptions);
  const result = await testRun(remoteHeavyTask, { value: 21 });
  console.log(`✅ Main: Received successful result: ${result}`);
  if (result !== 42) throw new Error(`Assertion failed! Expected 42, got ${result}`);

  // SCENARIO 2
  console.log("\n--- SCENARIO 2: Testing error propagation from worker ---");
  try {
    const remoteFailingTask = runOnWorker(worker, "failingTask", workerOptions);
    await testRun(remoteFailingTask, undefined);
  } catch (e: any) {
    const cause = e instanceof WorkflowError ? e.cause : e;
    console.log(`✅ Main: Correctly caught error from worker. Message: "${cause.message}"`);
    if (!cause.message.includes("Worker task failed deliberately")) throw new Error("Assertion failed!");
  }

  // SCENARIO 3
  console.log("\n--- SCENARIO 3: Testing cancellation of worker task ---");
  try {
    const controller = new AbortController();
    const promise = testRun(remoteHeavyTask, { value: 99 }, { parentSignal: controller.signal });
    setTimeout(() => {
      console.log("...[Main] Aborting task...");
      controller.abort(new DOMException("Aborted by main thread", "AbortError"));
    }, 50);
    await promise;
  } catch (e: any) {
    const cause = e instanceof WorkflowError ? e.cause : e;
    console.log(`✅ Main: Correctly caught cancellation error. Message: "${cause.message}"`);
    if (!cause.message.includes("Aborted by main thread")) throw new Error("Assertion failed!");
  }

  // SCENARIO 4
  console.log("\n--- SCENARIO 4: Testing successful `runStreamOnWorker` ---");
  const remoteStream = runStreamOnWorker<any, number, string>(worker, "streamingTask", workerOptions);
  const iterable = await testRun(remoteStream, 3);
  const results: string[] = [];
  for await (const value of iterable) {
    console.log(`[Main] Received value from stream: "${value}"`);
    results.push(value);
  }
  console.log("✅ Main: Stream loop finished.");
  const expected = ["Update #1", "Update #2", "Update #3"];
  if (JSON.stringify(results) !== JSON.stringify(expected)) throw new Error("Assertion failed!");
  console.log("✅ Main: Stream consumed successfully.");

  // SCENARIO 5
  console.log("\n--- SCENARIO 5: Testing failing stream ---");
  try {
    const remoteFailingStream = runStreamOnWorker<any, void, string>(worker, "failingStreamTask", workerOptions);
    const iterable = await testRun(remoteFailingStream, undefined);
    for await (const value of iterable) {
      console.log(`[Main] Received value from failing stream: "${value}"`);
    }
  } catch (e: any) {
    const cause = e instanceof WorkflowError ? e.cause : e;
    console.log(`✅ Main: Correctly caught failing stream error. Message: "${cause.message}"`);
    if (!cause.message.includes("Stream blew up")) throw new Error("Assertion failed!");
  }

  console.log("\n--- All scenarios complete. Terminating worker. ---");
  await worker.terminate();
  console.log("✅ Main: Worker terminated.");
}

main().catch((err) => {
  console.error("\n❌ Test runner failed with an unhandled exception:", err);
  process.exit(1);
});