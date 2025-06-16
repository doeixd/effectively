// File: test/manual-test.worker.ts

import { createWorkerHandler } from "../src/index";
import { DOMExceptionPlugin } from "seroval-plugins/web";
import { tasks } from "./manual-test-tasks";



console.log("[Worker] Worker script loaded. Initializing handler...");

createWorkerHandler(tasks, {
  plugins: [DOMExceptionPlugin],
});