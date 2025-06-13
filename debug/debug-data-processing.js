// @ts-nocheck
import { createContext } from '../src/run.js';
import { mapReduce } from '../src/data-processing.js';

const { run, defineTask, getContext } = createContext({
  multiplier: 2
});

const multiplyTask = defineTask(async (num) => {
  console.log('Multiply task called with:', num);
  const ctx = getContext();
  console.log('Context in multiply task:', { multiplier: ctx.multiplier });
  return num * ctx.multiplier;
});

const workflow = mapReduce([1, 2, 3], {
  map: multiplyTask,
  reduce: (acc, current) => acc + current,
  initial: 0
});

try {
  console.log('Starting mapReduce test...');
  const result = await run(workflow, null);
  console.log('Result:', result);
} catch (error) {
  console.error('Error:', error.message);
  console.error('Stack:', error.stack);
}
