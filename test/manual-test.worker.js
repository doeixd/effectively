// File: test/manual-test.worker.js
import { createWorkerHandler, defineTask, getContext } from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";

const heavyTask = defineTask(async (data) => {
  const context = getContext();
  for (let i = 0; i < 5; i++) {
    if (context.scope.signal.aborted) {
      throw new DOMException("Heavy task aborted by main thread", "AbortError");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  return data.value * 2;
});

const failingTask = defineTask(async () => {
  throw new Error("Worker task failed deliberately");
});

// --- CORRECTED STREAMING TASK (PULL MODEL) ---
const streamingTask = defineTask(async function* (count) {
  console.log(`[Worker] Starting to GENERATE stream for ${count} updates...`);
  const context = getContext();
  for (let i = 1; i <= count; i++) {
    if (context.scope.signal.aborted) {
      console.log("[Worker] Stream generation aborted.");
      throw new DOMException("Stream aborted by worker", "AbortError");
    }
    await new Promise((r) => setTimeout(r, 50));
    console.log(`[Worker] Yielding "Update #${i}"`);
    yield `Update #${i}`;
  }
  console.log("[Worker] Stream generation finished.");
});

const failingStreamTask = defineTask(async function* () {
  console.log("[Worker] Starting a stream that will fail...");
  yield "First value";
  await new Promise((r) => setTimeout(r, 10));
  throw new Error("Stream blew up");
});

console.log("[Worker] Worker script loaded. Initializing handler...");
createWorkerHandler(
  {
    heavyTask,
    failingTask,
    streamingTask,
    failingStreamTask,
  },
  { plugins: [DOMExceptionPlugin] },
);
