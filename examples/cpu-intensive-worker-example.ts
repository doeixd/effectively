import {
  runOnWorker,
  type RunOnWorkerOptions,
} from '../src/index'; // Adjust path
import {
  createContext,
  run,
  type BaseContext,
} from '../src/index'; // Adjust path
// import { DOMExceptionPlugin } from 'http://esm.sh/seroval-plugins/web';
const { DOMExceptionPlugin } = await import('http://esm.sh/seroval-plugins/web')

// Node.js specific: Bun might not need this, but good for Node.
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface AppContext extends BaseContext { mainThreadId: string; }
const { run: appRun } = createContext<AppContext>({ mainThreadId: 'main-app-thread' });

// For Bun, `new URL('./cpu-worker-plain.ts', import.meta.url)` would be fine.
// For Node, it needs an absolute path or a file URL.
const workerPath = path.resolve(__dirname, 'cpu-worker-plain.ts'); // Assuming worker is in same dir
const myWorker = new Worker(workerPath); // Node's Worker

const serovalMainOptions: RunOnWorkerOptions = { plugins: [DOMExceptionPlugin] };

async function main() {
  console.log('\n--- CPU-Intensive Worker Example (Plain TS) ---');
  const complexDataObject = {
    id: 'data-set-123',
    timestamp: new Date(),
    values: Array.from({ length: 1000000 }, () => Math.random() * 100),
    metadata: new Map([['source', 'sensor-A'], ['quality', 'high']]),
  };

  const remoteProcessData = runOnWorker<AppContext, typeof complexDataObject, any>(
    myWorker, 'processData', serovalMainOptions
  );

  // --- Scenario 1: Successful execution ---
  console.log('\n--- Scenario 1: Running successful worker task... ---');
  try {
    const result = await appRun(remoteProcessData, complexDataObject);
    console.log('✅ Worker Result:', result);
    console.assert(result.originalId === 'data-set-123', "Test 1 originalId failed");
    console.assert(typeof result.processedSum === 'number', "Test 1 processedSum type failed");
    console.assert(result.metadataSize === 2, "Test 1 metadataSize failed");
  } catch (e) {
    console.error('❌ Worker task failed unexpectedly:', e);
  }

  // --- Scenario 2: Execution with cancellation ---
  console.log('\n--- Scenario 2: Running worker task with cancellation... ---');
  const abortController = new AbortController();
  const remoteProcessDataCancellable = runOnWorker<AppContext, typeof complexDataObject, any>(
    myWorker, 'processData', serovalMainOptions
  );

  setTimeout(() => {
    console.log('[Main] Aborting worker task...');
    abortController.abort(new Error('User requested cancellation from main'));
  }, 100); // Abort fairly quickly (adjust if worker task finishes too fast)

  try {
    const result = await appRun(remoteProcessDataCancellable,
      { ...complexDataObject, id: 'data-set-cancellable' },
      { parentSignal: abortController.signal }
    );
    console.log('⚠️ Worker (Cancelled) Result (should not be reached if abort is fast enough):', result);
    console.assert(false, "Test 2 Cancellation failed - task completed");
  } catch (e: any) {
    console.error('✅ Worker task correctly aborted/failed:', e.name, e.message);
    const cause = e.cause || (e.reason ? e.reason.cause : null); // DOMException might have reason.cause
    console.assert(e.name === 'AbortError' || (cause && cause.name === 'AbortError'), "Test 2 Not an AbortError");
  }

  console.log('[Main] Requesting worker termination...');
  await myWorker.terminate(); // For Node.js worker_threads
  console.log('[Main] Worker terminated.');
  console.log("\nCPU Worker Example tests complete.");
}

main().catch(e => console.error("Unhandled Main Error in CPU Worker Example:", e));