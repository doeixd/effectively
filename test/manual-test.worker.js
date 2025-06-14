// File: test/manual-test.worker.js
import { createWorkerHandler, defineTask, getContext } from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";

const heavyTask = defineTask(async (data) => {
  const context = getContext();
  console.log("[Worker] Starting heavy task...");
  // Make the task definitively longer than the cancellation timeout
  for (let i = 0; i < 15; i++) {
    if (context.scope.signal.aborted) {
      console.log("[Worker] Heavy task was aborted!");
      throw new DOMException("Heavy task aborted by main thread", "AbortError");
    }
    await new Promise((r) => setTimeout(r, 10)); // 150ms total runtime
  }
  console.log("[Worker] Heavy task finished successfully.");
  return data.value * 2;
});

const failingTask = defineTask(async () => {
  console.log("[Worker] Running a task that will fail...");
  throw new Error("Worker task failed deliberately");
});

const streamingTask = defineTask(async (count) => {
  console.log(`[Worker] Starting stream for ${count} updates...`);
  const context = getContext();
  try {
    for (let i = 1; i <= count; i++) {
      if (context.scope.signal.aborted) {
        context.stream.throw(
          new DOMException("Stream aborted by worker", "AbortError"),
        );
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
      context.stream.next(`Update #${i}`);
    }
    // Signal completion to the main thread's iterable.
    context.stream.return();
    console.log("[Worker] Stream finished.");
  } catch (e) {
    console.error("[Worker] Error in streaming task:", e);
    // Ensure the stream is terminated on error.
    context.stream.throw(e);
  }
});

const failingStreamTask = defineTask(async () => {
  console.log("[Worker] Starting a stream that will fail...");
  const context = getContext();
  context.stream.next("First value");
  await new Promise((r) => setTimeout(r, 10));
  context.stream.throw(new Error("Stream blew up"));
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
