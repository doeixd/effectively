// This script runs in the worker thread for testing purposes.
import {
  createWorkerHandler,
  defineTask,
  getContext,
  type BaseContext,
  type StreamHandle,
} from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";

// --- Task Definitions ---

const heavyTask = defineTask(async (data: { value: number }) => {
  const context = getContext<BaseContext>();
  // Simulate some work and check for cancellation periodically.
  for (let i = 0; i < 5; i++) {
    if (context.scope.signal.aborted) {
      throw new DOMException("Heavy task aborted", "AbortError");
    }
    await new Promise((r) => setTimeout(r, 1));
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
    await new Promise((r) => setTimeout(r, 2));
    context.stream.next(`Update ${i}/${count}`);
  }
  context.stream.return();
});

const failingStreamTask = defineTask(async () => {
  const context = getContext<StreamingTaskContext>();
  context.stream.next("First value");
  context.stream.throw(new Error("Stream blew up"));
});

// --- Initialize the Worker Handler ---
// Register all tasks the worker can perform, each with a unique string key.
createWorkerHandler(
  {
    heavyTask,
    failingTask,
    streamingTask,
    failingStreamTask,
  },
  { plugins: [DOMExceptionPlugin] },
);
