import { describe, it, expect } from 'vitest';
import { ok, err } from 'neverthrow';
import {
  doTask,
  createDoNotation,
  pure,
  call,
  doWhen,
  doUnless,
  sequence,
  forEach
} from '../src/do-notation';
import {
  createContext,
  defineTask,
  getContext,
  type BaseContext
} from '../src/run';

interface TestContext extends BaseContext {
  counter: number;
  logs: string[];
}

const { run, getContext: getTestContext } = createContext<TestContext>({
  counter: 0,
  logs: []
});

const { doTask: testDoTask, doBlock } = createDoNotation<TestContext>();

// Helper tasks for testing
const incrementCounter = defineTask<TestContext, void, number>(async () => {
  const ctx = getTestContext();
  ctx.counter++;
  return ctx.counter;
});

const logMessage = defineTask<TestContext, string, string>(async (message: string) => {
  const ctx = getTestContext();
  ctx.logs.push(message);
  return message;
});

const getValue = defineTask<TestContext, number, number>(async (value: number) => value);

const failingTask = defineTask<TestContext, boolean, string>(async (shouldFail: boolean) => {
  if (shouldFail) {
    throw new Error('Task failed');
  }
  return 'success';
});

describe('Do Notation', () => {
  describe('doTask', () => {
    it('should execute simple do block with tasks', async () => {
      const workflow = doTask(function* () {
        const count1 = yield call(incrementCounter, undefined);
        const count2 = yield call(incrementCounter, undefined);
        return count1 + count2;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(3); // 1 + 2
    });

    it('should handle input values', async () => {
      const workflow = doTask(function* (multiplier: number) {
        const count1 = yield call(incrementCounter, undefined);
        const count2 = yield call(incrementCounter, undefined);
        return (count1 + count2) * multiplier;
      });

      const result = await run(workflow, 10);
      expect(result).toBe(30); // (1 + 2) * 10
    });

    it('should handle plain values with pure', async () => {
      const workflow = doTask(function* () {
        const value1 = yield pure(42);
        const value2 = yield pure(8);
        return value1 + value2;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(50);
    });

    it('should handle Promise values', async () => {
      const workflow = doTask(function* () {
        const value1 = yield Promise.resolve(10);
        const value2 = yield Promise.resolve(20);
        return value1 + value2;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(30);
    });

    it('should handle Result types - success case', async () => {
      const workflow = doTask(function* () {
        const value1 = yield ok(15);
        const value2 = yield ok(25);
        return value1 + value2;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(40);
    });

    it('should handle Result types - error case', async () => {
      const workflow = doTask(function* () {
        const value1 = yield ok(15);
        const value2 = yield err(new Error('Failed'));
        return value1 + value2;
      });

      await expect(run(workflow, undefined)).rejects.toThrow('Failed');
    });

    it('should propagate errors from tasks', async () => {
      const workflow = doTask(function* () {
        yield call(failingTask, false);
        yield call(failingTask, true); // This should fail
        return 'should not reach here';
      });

      await expect(run(workflow, undefined)).rejects.toThrow('Task failed');
    });

    it('should handle try/catch in generators', async () => {
      const workflow = doTask(function* () {
        try {
          yield call(failingTask, true);
          return 'should not reach here';
        } catch (error) {
          yield call(logMessage, 'Caught error');
          return 'error handled';
        }
      });

      const result = await run(workflow, undefined);
      expect(result).toBe('error handled');
    });
  });

  describe('context-specific doTask', () => {
    it('should work with typed context', async () => {
      const workflow = testDoTask(function* () {
        const count = yield call(incrementCounter, undefined);
        yield call(logMessage, `Count: ${count}`);
        return count;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(1);
    });

    it('should work with doBlock for no-input workflows', async () => {
      const workflow = doBlock(function* () {
        yield call(logMessage, 'Starting');
        const count = yield call(incrementCounter, undefined);
        yield call(logMessage, 'Finished');
        return count;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(1);
    });
  });

  describe('conditional functions', () => {
    it('should execute doWhen with true condition', async () => {
      const workflow = doTask(function* () {
        const result = yield doWhen(
          true,
          () => call(getValue, 42),
          () => call(getValue, 0)
        );
        return result;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(42);
    });

    it('should execute doWhen with false condition', async () => {
      const workflow = doTask(function* () {
        const result = yield doWhen(
          false,
          () => call(getValue, 42),
          () => call(getValue, 99)
        );
        return result;
      });

      const result = await run(workflow, undefined);
      expect(result).toBe(99);
    });

    it('should execute doUnless with false condition', async () => {
      const workflow = doTask(function* () {
        yield doUnless(false, () => call(logMessage, 'Executed'));
        return 'done';
      });

      const result = await run(workflow, undefined);
      expect(result).toBe('done');
    });

    it('should skip doUnless with true condition', async () => {
      const workflow = doTask(function* () {
        yield doUnless(true, () => call(logMessage, 'Should not execute'));
        return 'done';
      });

      const result = await run(workflow, undefined);
      expect(result).toBe('done');
    });
  });

  describe('sequence function', () => {
    it('should execute tasks in sequence and collect results', async () => {
      const workflow = doTask(function* () {
        const results = yield call(sequence([
          call(getValue, 1),
          call(getValue, 2),
          call(getValue, 3)
        ]), undefined);
        return results;
      });

      const result = await run(workflow, undefined);
      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle empty sequence', async () => {
      const workflow = doTask(function* () {
        const results = yield call(sequence([]), undefined);
        return results;
      });

      const result = await run(workflow, undefined);
      expect(result).toEqual([]);
    });
  });

  describe('forEach function', () => {
    it('should iterate over items and execute generator for each', async () => {
      const workflow = doTask(function* () {
        yield call(forEach([1, 2, 3], function* (item) {
          yield call(logMessage, `Processing ${item}`);
        }), undefined);
        return 'done';
      });

      const result = await run(workflow, undefined);
      expect(result).toBe('done');
    });

    it('should handle empty array', async () => {
      const workflow = doTask(function* () {
        yield call(forEach([], function* (item) {
          yield call(logMessage, `Should not process ${item}`);
        }), undefined);
        return 'done';
      });

      const result = await run(workflow, undefined);
      expect(result).toBe('done');
    });
  });

  describe('integration tests', () => {
    it('should handle complex workflow with multiple patterns', async () => {
      const workflow = testDoTask(function* (shouldProcess: boolean) {
        // Log start
        yield call(logMessage, 'Starting complex workflow');
        
        // Conditional processing
        const processedCount = yield doWhen(
          shouldProcess,
          () => call(sequence([
            call(incrementCounter, undefined),
            call(incrementCounter, undefined),
            call(incrementCounter, undefined)
          ]), undefined),
          () => pure([0])
        );
        
        // Process results
        const total = processedCount.reduce((sum: number, count: number) => sum + count, 0);
        
        // Log results
        yield call(logMessage, `Total: ${total}`);
        
        // Conditional final step
        yield doUnless(total === 0, () => call(logMessage, 'Processing completed'));
        
        return total;
      });

      const result1 = await run(workflow, true);
      expect(result1).toBe(6); // 1 + 2 + 3

      const result2 = await run(workflow, false);
      expect(result2).toBe(0);
    });
  });
});
