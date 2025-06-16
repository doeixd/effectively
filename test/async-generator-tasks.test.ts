import { describe, it, expect, vi } from 'vitest';
import { defineTask, run, createContext } from '../src/run';
import type { Task, BaseContext } from '../src/run';
import { getContext } from '../src';

describe('defineTask with Async Generators (Streaming)', () => {
  // Test 1: Testing the global `defineTask`
  describe('Global defineTask', () => {
    it('should set __task_type to "stream" for an async generator', () => {
      const streamingTask = defineTask(async function* (count: number) {
        for (let i = 0; i < count; i++) {
          yield i;
        }
      });

      // Assert that the metadata is correctly attached
      expect(streamingTask).toHaveProperty('__task_type', 'stream');
    });

    it('should return an AsyncIterable when a streaming task is run', async () => {
      const streamingTask = defineTask(async function* (limit: number) {
        yield 'start';
        for (let i = 0; i < limit; i++) {
          yield `item ${i}`;
        }
        yield 'end';
      });

      // The result of `run` should be the iterable itself
      const iterable = await run(streamingTask, 3);

      // Verify it is an async iterable
      expect(iterable[Symbol.asyncIterator]).toBeTypeOf('function');

      // Collect results to verify the stream content
      const results = [];
      for await (const value of iterable) {
        results.push(value);
      }

      expect(results).toEqual(['start', 'item 0', 'item 1', 'item 2', 'end']);
    });

    it('should set __task_type to "request" for a standard async function', () => {
      const regularTask = defineTask(async (data: number) => {
        return data * 2;
      });

      expect(regularTask).toHaveProperty('__task_type', 'request');
    });
  });

  // Test 2: Testing the context-bound `defineTask` from `createContext`
  describe('Context-bound defineTask from createContext', () => {
    interface MyAppContext extends BaseContext {
      multiplier: number;
    }

    const { defineTask: defineAppTask, run: runApp } = createContext<MyAppContext>({
      multiplier: 10,
    });

    it('should set __task_type to "stream" for a context-bound async generator', () => {
      const streamingAppTask = defineAppTask(async function* (count: number) {
        for (let i = 0; i < count; i++) {
          yield i;
        }
      });

      // Assert metadata on the context-bound task
      expect(streamingAppTask).toHaveProperty('__task_type', 'stream');
    });

    it('should return an AsyncIterable when a context-bound streaming task is run', async () => {
      const streamingAppTask = defineAppTask(async function* (limit: number) {
        // This task doesn't use the context, but it's defined within it
        for (let i = 0; i < limit; i++) {
          yield `value ${i + 1}`;
        }
      });

      const iterable = await runApp(streamingAppTask, 2);

      // Verify it is an async iterable
      expect(iterable[Symbol.asyncIterator]).toBeTypeOf('function');

      // Collect and verify results
      const results = [];
      for await (const value of iterable) {
        results.push(value);
      }

      expect(results).toEqual(['value 1', 'value 2']);
    });

    it('should not prematurely close the scope for a streaming task', async () => {
      let taskScopeSignal: AbortSignal | undefined;

      const streamingTask = defineTask(async function* () {
        // Capture the signal from the context when the task runs
        const { scope } = getContext();
        taskScopeSignal = scope.signal;
        yield 1; // Yield once to ensure the task has started
      });

      const iterable = await run(streamingTask, undefined);

      // Start consuming the stream
      const iterator = iterable[Symbol.asyncIterator]();
      await iterator.next();

      // Crucially, the scope signal should NOT be aborted yet, because the
      // stream is still open and could be consumed further.
      expect(taskScopeSignal?.aborted).toBe(false);

      // Finish consuming (which implicitly closes the stream)
      await iterator.next();

      // The test doesn't need to assert on the final state, just that
      // it wasn't closed prematurely.
    });
  });
});