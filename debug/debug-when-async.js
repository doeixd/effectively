// @ts-nocheck
import { createContext, defineTask } from '../src/run.js';
import { createWorkflow, fromValue, when } from '../src/utils.js';

const { run } = createContext({ userId: 'test-user' });

const addSuffix = defineTask(async (str) => `${str}-processed`);

const workflow = createWorkflow(
  fromValue('hello'),
  when(async (str) => {
    await new Promise(resolve => setTimeout(resolve, 10));
    return str.length > 3;
  }, addSuffix)
);

try {
  console.log('Starting async when test...');
  const result = await run(workflow, undefined);
  console.log('Result:', result);
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
