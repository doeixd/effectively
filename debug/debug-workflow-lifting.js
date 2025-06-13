//@ts-nocheck
import { createContext, defineTask } from '../src/run.js';
import { createWorkflow, fromValue } from '../src/utils.js';

const { run } = createContext({ userId: 'test-user' });

// Test different types of functions
const syncFunction = (x) => x * 2;
const asyncFunction = async (x) => x + 10;
const taskFunction = defineTask(async (x) => x + 100);

// Manual task-like function (should be detected as task)
const manualTask = async (context, value) => {
  console.log('Manual task with context:', context.userId);
  return value + 1000;
};

const workflow = createWorkflow(
  fromValue(5),
  syncFunction,     // Should be lifted: 5 * 2 = 10
  asyncFunction,    // Should be lifted: 10 + 10 = 20
  taskFunction,     // Already a task: 20 + 100 = 120
  manualTask        // Should be detected as task: 120 + 1000 = 1120
);

try {
  console.log('Testing workflow with mixed function types...');
  const result = await run(workflow, undefined);
  console.log('Result:', result);
  console.log('Expected: 1120');
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
