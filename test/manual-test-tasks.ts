// File: test/manual-test-tasks.ts
import { defineTask, getContext } from "../src/index";
// DOMException is a global type, no import needed.

/**
 * A helper that creates a delay promise that will reject if the provided
 * AbortSignal is aborted. This makes long-running tasks responsive to cancellation.
 */
function cancellableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(signal.reason);
    }
    const timeoutId = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timeoutId);
      reject(signal.reason);
    }, { once: true });
  });
}

export type tasks = typeof tasks

export const tasks = {
  heavyTask: defineTask(async (data: { value: number }) => {
    const { scope } = getContext();
    console.log("[Worker] Starting heavy task...");
    // Use the cancellableDelay to make the task responsive during waits.
    for (let i = 0; i < 5; i++) {
      await cancellableDelay(25, scope.signal);
    }
    console.log("[Worker] Heavy task finished.");
    return data.value * 2;
  }),

  failingTask: defineTask(async (_value: void) => {
    console.log("[Worker] Executing failing task...");
    throw new Error("Worker task failed deliberately");
  }),

  streamingTask: defineTask(async function* (count: number) {
    console.log(`[Worker] Starting to GENERATE stream for ${count} updates...`);
    const { scope } = getContext();
    for (let i = 1; i <= count; i++) {
      await cancellableDelay(50, scope.signal);
      console.log(`[Worker] Yielding "Update #${i}"`);
      yield `Update #${i}`;
    }
    console.log("[Worker] Stream generation finished.");
    return
  }),

  failingStreamTask: defineTask(async function* (_value: void) {
    console.log("[Worker] Starting a stream that will fail...");
    const { scope } = getContext();
    yield "First value";
    await cancellableDelay(10, scope.signal);
    throw new Error("Stream blew up");
  }),
};