import { doTask, call, pure } from './dist/index.mjs';
import { createContext, defineTask } from './dist/index.mjs';

// Simple test to verify do notation works
console.log('Testing do notation...');

const { run } = createContext({ logs: [] });

const getNumber = defineTask(async (n) => {
  console.log(`Getting number: ${n}`);
  return n;
});

const addNumbers = defineTask(async ([a, b]) => {
  console.log(`Adding: ${a} + ${b}`);
  return a + b;
});

const workflow = doTask(function* () {
  console.log('Starting workflow...');
  const a = yield call(getNumber, 5);
  const b = yield call(getNumber, 3);
  const sum = yield call(addNumbers, [a, b]);
  return sum;
});

try {
  const result = await run(workflow, undefined);
  console.log('Result:', result);
  console.log('✅ Do notation test passed!');
} catch (error) {
  console.error('❌ Test failed:', error);
  process.exit(1);
}
