import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  forkJoin,
  ift,
  allTuple
} from '../src/structured-concurrency';
import {
  createContext,
  type BaseContext,
  type Task
} from '../src/run';

interface TestContext extends BaseContext {
  userId: string;
  apiDelay: number;
  shouldSucceed: boolean;
}

const testContextDefaults: Omit<TestContext, 'scope'> = {
  userId: 'test-user',
  apiDelay: 10,
  shouldSucceed: true
};

describe('Structured Concurrency (structured-concurrency.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('forkJoin', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should execute tasks in parallel and return keyed results', async () => {
      const fetchUser = defineTask(async (userId: string) => {
        const ctx = getContext<TestContext>();
        await new Promise(resolve => setTimeout(resolve, ctx.apiDelay));
        return { id: userId, name: 'John Doe' };
      });

      const fetchPosts = defineTask(async (userId: string) => {
        const ctx = getContext<TestContext>();
        await new Promise(resolve => setTimeout(resolve, ctx.apiDelay));
        return [{ id: 1, title: 'Post 1' }, { id: 2, title: 'Post 2' }];
      });

      const fetchPermissions = defineTask(async (userId: string) => {
        const ctx = getContext<TestContext>();
        await new Promise(resolve => setTimeout(resolve, ctx.apiDelay));
        return ['read', 'write'];
      });

      const workflow = forkJoin({
        user: fetchUser,
        posts: fetchPosts,
        permissions: fetchPermissions
      });

      const start = Date.now();
      const promise = run(workflow, 'user-123');
      
      // Advance timers to simulate parallel execution
      vi.advanceTimersByTime(10);
      const result = await promise;
      const elapsed = Date.now() - start;

      expect(result).toEqual({
        user: { id: 'user-123', name: 'John Doe' },
        posts: [{ id: 1, title: 'Post 1' }, { id: 2, title: 'Post 2' }],
        permissions: ['read', 'write']
      });

      // Should complete in parallel time, not sequential
      expect(elapsed).toBeLessThan(30); // Less than 3 * apiDelay
    });

    it('should handle empty task object', async () => {
      const workflow = forkJoin({});
      const result = await run(workflow, 'test-input');
      expect(result).toEqual({});
    });

    it('should handle single task', async () => {
      const singleTask = defineTask(async (input: string) => `processed-${input}`);
      const workflow = forkJoin({ result: singleTask });
      
      const result = await run(workflow, 'test');
      expect(result).toEqual({ result: 'processed-test' });
    });

    it('should pass the same input to all tasks', async () => {
      const captureInputTask = defineTask(async (input: string) => input);
      
      const workflow = forkJoin({
        task1: captureInputTask,
        task2: captureInputTask,
        task3: captureInputTask
      });

      const result = await run(workflow, 'shared-input');
      expect(result).toEqual({
        task1: 'shared-input',
        task2: 'shared-input',
        task3: 'shared-input'
      });
    });

    it('should handle task failures correctly', async () => {
      const successTask = defineTask(async () => 'success');
      const failingTask = defineTask(async () => {
        throw new Error('Task failed');
      });

      const workflow = forkJoin({
        success: successTask,
        failure: failingTask
      });

      await expect(run(workflow, 'test')).rejects.toThrow('Task failed');
    });

    it('should maintain type safety', async () => {
      const stringTask = defineTask(async (input: string) => `string-${input}`);
      const numberTask = defineTask(async (input: string) => input.length);
      const booleanTask = defineTask(async (input: string) => input.includes('test'));

      const workflow = forkJoin({
        str: stringTask,
        num: numberTask,
        bool: booleanTask
      });

      const result = await run(workflow, 'test-input');
      
      // TypeScript should infer the correct types
      expect(typeof result.str).toBe('string');
      expect(typeof result.num).toBe('number');
      expect(typeof result.bool).toBe('boolean');
      
      expect(result.str).toBe('string-test-input');
      expect(result.num).toBe(10); // 'test-input'.length
      expect(result.bool).toBe(true); // 'test-input'.includes('test')
    });

    it('should respect context overrides', async () => {
      const contextTask = defineTask(async (input: string) => {
        const ctx = getContext<TestContext>();
        return `${input}-${ctx.userId}`;
      });

      const workflow = forkJoin({
        result1: contextTask,
        result2: contextTask
      });

      const result = await run(workflow, 'test', {
        overrides: { userId: 'custom-user' }
      });

      expect(result).toEqual({
        result1: 'test-custom-user',
        result2: 'test-custom-user'
      });
    });
  });

  describe('ift (if-then-else)', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should execute onTrue task when predicate is true', async () => {
      const onTrueTask = defineTask(async (input: string) => `true-branch-${input}`);
      const onFalseTask = defineTask(async (input: string) => `false-branch-${input}`);

      const workflow = ift(
        (value: string) => value.includes('positive'),
        onTrueTask,
        onFalseTask
      );

      const result = await run(workflow, 'positive-test');
      expect(result).toBe('true-branch-positive-test');
    });

    it('should execute onFalse task when predicate is false', async () => {
      const onTrueTask = defineTask(async (input: string) => `true-branch-${input}`);
      const onFalseTask = defineTask(async (input: string) => `false-branch-${input}`);

      const workflow = ift(
        (value: string) => value.includes('positive'),
        onTrueTask,
        onFalseTask
      );

      const result = await run(workflow, 'negative-test');
      expect(result).toBe('false-branch-negative-test');
    });

    it('should work with async predicates', async () => {
      const onTrueTask = defineTask(async (input: string) => `async-true-${input}`);
      const onFalseTask = defineTask(async (input: string) => `async-false-${input}`);

      const asyncPredicate = async (value: string) => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return value.length > 5;
      };

      const workflow = ift(asyncPredicate, onTrueTask, onFalseTask);

      const promise1 = run(workflow, 'short');
      vi.advanceTimersByTime(10);
      const result1 = await promise1;
      expect(result1).toBe('async-false-short');

      const promise2 = run(workflow, 'very-long-string');
      vi.advanceTimersByTime(10);
      const result2 = await promise2;
      expect(result2).toBe('async-true-very-long-string');
    });

    it('should pass context to predicate', async () => {
      const onTrueTask = defineTask(async (input: string) => `context-true-${input}`);
      const onFalseTask = defineTask(async (input: string) => `context-false-${input}`);

      const contextPredicate = (value: string, context: TestContext) => {
        return context.shouldSucceed;
      };

      const workflow = ift(contextPredicate, onTrueTask, onFalseTask);

      const result1 = await run(workflow, 'test', {
        overrides: { shouldSucceed: true }
      });
      expect(result1).toBe('context-true-test');

      const result2 = await run(workflow, 'test', {
        overrides: { shouldSucceed: false }
      });
      expect(result2).toBe('context-false-test');
    });

    it('should handle errors in predicate', async () => {
      const onTrueTask = defineTask(async () => 'true');
      const onFalseTask = defineTask(async () => 'false');

      const failingPredicate = () => {
        throw new Error('Predicate failed');
      };

      const workflow = ift(failingPredicate, onTrueTask, onFalseTask);

      await expect(run(workflow, 'test')).rejects.toThrow('Predicate failed');
    });

    it('should handle errors in branch tasks', async () => {
      const failingTask = defineTask(async () => {
        throw new Error('Branch task failed');
      });
      const successTask = defineTask(async () => 'success');

      const workflow = ift(
        () => true,
        failingTask,
        successTask
      );

      await expect(run(workflow, 'test')).rejects.toThrow('Branch task failed');
    });

    it('should support different return types from branches', async () => {
      const numberTask = defineTask(async (input: string) => input.length);
      const stringTask = defineTask(async (input: string) => `length-unknown-${input}`);

      const workflow = ift(
        (value: string) => !isNaN(Number(value)),
        numberTask,
        stringTask
      );

      // When input is numeric string, return number
      const result1 = await run(workflow, '123');
      expect(result1).toBe(3);
      expect(typeof result1).toBe('number');

      // When input is non-numeric, return string
      const result2 = await run(workflow, 'hello');
      expect(result2).toBe('length-unknown-hello');
      expect(typeof result2).toBe('string');
    });

    it('should work with complex conditional logic', async () => {
      const fetchUserData = defineTask(async (userId: string) => {
        return { id: userId, isAdmin: userId.includes('admin') };
      });

      const adminTask = defineTask(async (input: string) => `admin-access-${input}`);
      const userTask = defineTask(async (input: string) => `user-access-${input}`);

      const conditionalWorkflow = ift(
        async (userId: string, context: TestContext) => {
          const userData = await fetchUserData(context, userId);
          return userData.isAdmin;
        },
        adminTask,
        userTask
      );

      const adminResult = await run(conditionalWorkflow, 'admin-user-123');
      expect(adminResult).toBe('admin-access-admin-user-123');

      const userResult = await run(conditionalWorkflow, 'regular-user-456');
      expect(userResult).toBe('user-access-regular-user-456');
    });
  });

  describe('allTuple', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should execute tasks in parallel and return typed tuple', async () => {
      const stringTask = defineTask(async (input: string) => `result-${input}`);
      const numberTask = defineTask(async (input: string) => input.length);
      const booleanTask = defineTask(async (input: string) => input.includes('test'));

      const workflow = allTuple([stringTask, numberTask, booleanTask]);
      const result = await run(workflow, 'test-input');

      expect(result).toEqual(['result-test-input', 10, true]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it('should handle empty array', async () => {
      const workflow = allTuple([]);
      const result = await run(workflow, 'test');
      expect(result).toEqual([]);
    });

    it('should handle single task', async () => {
      const singleTask = defineTask(async (input: string) => input.toUpperCase());
      const workflow = allTuple([singleTask]);
      
      const result = await run(workflow, 'hello');
      expect(result).toEqual(['HELLO']);
    });

    it('should execute tasks in parallel', async () => {
      const slowTask1 = defineTask(async (input: string) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return `slow1-${input}`;
      });

      const slowTask2 = defineTask(async (input: string) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return `slow2-${input}`;
      });

      const start = Date.now();
      const promise = run(allTuple([slowTask1, slowTask2]), 'test');
      
      vi.advanceTimersByTime(50);
      const result = await promise;
      const elapsed = Date.now() - start;

      expect(result).toEqual(['slow1-test', 'slow2-test']);
      expect(elapsed).toBeLessThan(80); // Should be parallel, not sequential (100ms)
    });

    it('should handle task failures', async () => {
      const successTask = defineTask(async () => 'success');
      const failingTask = defineTask(async () => {
        throw new Error('Task failed');
      });

      const workflow = allTuple([successTask, failingTask]);
      await expect(run(workflow, 'test')).rejects.toThrow('Task failed');
    });

    it('should maintain order of results', async () => {
      const task1 = defineTask(async () => 'first');
      const task2 = defineTask(async () => 'second');
      const task3 = defineTask(async () => 'third');

      const workflow = allTuple([task1, task2, task3]);
      const result = await run(workflow, 'test');

      expect(result).toEqual(['first', 'second', 'third']);
    });

    it('should pass same input to all tasks', async () => {
      const captureTask = defineTask(async (input: string) => input);
      const workflow = allTuple([captureTask, captureTask, captureTask]);

      const result = await run(workflow, 'shared-input');
      expect(result).toEqual(['shared-input', 'shared-input', 'shared-input']);
    });
  });

  describe('Integration tests', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should combine forkJoin and ift for complex workflows', async () => {
      const fetchUser = defineTask(async (userId: string) => ({
        id: userId,
        type: userId.includes('admin') ? 'admin' : 'user'
      }));

      const fetchAdminData = defineTask(async () => ({
        permissions: ['all'],
        dashboard: 'admin-dashboard'
      }));

      const fetchUserData = defineTask(async () => ({
        permissions: ['read'],
        dashboard: 'user-dashboard'
      }));

      const complexWorkflow = defineTask(async (userId: string) => {
        // First, get user info and determine type
        const user = await fetchUser(getContext(), userId);
        
        // Then conditionally fetch appropriate data
        const data = await ift(
          (_, __) => user.type === 'admin',
          fetchAdminData,
          fetchUserData
        )(getContext(), userId);

        return { user, ...data };
      });

      const adminResult = await run(complexWorkflow, 'admin-user-123');
      expect(adminResult).toEqual({
        user: { id: 'admin-user-123', type: 'admin' },
        permissions: ['all'],
        dashboard: 'admin-dashboard'
      });

      const userResult = await run(complexWorkflow, 'regular-user-456');
      expect(userResult).toEqual({
        user: { id: 'regular-user-456', type: 'user' },
        permissions: ['read'],
        dashboard: 'user-dashboard'
      });
    });

    it('should handle nested forkJoin operations', async () => {
      const fetchData1 = defineTask(async () => 'data1');
      const fetchData2 = defineTask(async () => 'data2');
      const fetchData3 = defineTask(async () => 'data3');
      const fetchData4 = defineTask(async () => 'data4');

      const innerFork = forkJoin({
        inner1: fetchData3,
        inner2: fetchData4
      });

      const outerFork = forkJoin({
        outer1: fetchData1,
        outer2: fetchData2,
        nested: innerFork
      });

      const result = await run(outerFork, 'test');
      expect(result).toEqual({
        outer1: 'data1',
        outer2: 'data2',
        nested: {
          inner1: 'data3',
          inner2: 'data4'
        }
      });
    });

    it('should handle complex predicate logic in ift', async () => {
      const processOrder = defineTask(async (order: { amount: number; vip: boolean }) => {
        return `processed-${order.amount}-${order.vip}`;
      });

      const expediteOrder = defineTask(async (order: { amount: number; vip: boolean }) => {
        return `expedited-${order.amount}-${order.vip}`;
      });

      const workflow = ift(
        (order: { amount: number; vip: boolean }) => order.amount > 1000 || order.vip,
        expediteOrder,
        processOrder
      );

      const vipResult = await run(workflow, { amount: 500, vip: true });
      expect(vipResult).toBe('expedited-500-true');

      const highValueResult = await run(workflow, { amount: 1500, vip: false });
      expect(highValueResult).toBe('expedited-1500-false');

      const regularResult = await run(workflow, { amount: 500, vip: false });
      expect(regularResult).toBe('processed-500-false');
    });
  });
});
