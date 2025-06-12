import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  mapReduce,
  filter,
  groupBy
} from '../src/data-processing';
import {
  createContext,
  defineTask,
  getContext,
  run,
  type BaseContext,
  type Task
} from '../src/run';

interface TestContext extends BaseContext {
  processDelay: number;
  multiplier: number;
  filterCriteria: string;
}

const testContextDefaults: Omit<TestContext, 'scope'> = {
  processDelay: 10,
  multiplier: 2,
  filterCriteria: 'active'
};

describe('Data Processing (data-processing.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Fake timers disabled due to compatibility issues with unctx context system
    // vi.useFakeTimers();
  });

  afterEach(() => {
    // vi.useRealTimers();
  });

  describe('mapReduce', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should perform parallel map and sequential reduce', async () => {
      const numbers = [1, 2, 3, 4, 5];
      
      const multiplyTask = defineTask(async (num: number) => {
        const ctx = getContext();
        await new Promise(resolve => setTimeout(resolve, ctx.processDelay));
        return num * ctx.multiplier;
      });

      const workflow = mapReduce(numbers, {
        map: multiplyTask,
        reduce: (acc, current) => acc + current,
        initial: 0
      });

      const start = Date.now();
      const result = await run(workflow, null);
      const elapsed = Date.now() - start;

      expect(result).toBe(30); // (1*2) + (2*2) + (3*2) + (4*2) + (5*2) = 30
      expect(elapsed).toBeLessThan(100); // Should be roughly parallel, allowing some overhead
    });

    it('should handle empty arrays', async () => {
      const emptyArray: number[] = [];
      
      const processTask = defineTask(async (num: number) => num * 2);

      const workflow = mapReduce(emptyArray, {
        map: processTask,
        reduce: (acc, current) => acc + current,
        initial: 100
      });

      const result = await run(workflow, null);
      expect(result).toBe(100); // Should return initial value
    });

    it('should handle single element arrays', async () => {
      const singleArray = [42];
      
      const doubleTask = defineTask(async (num: number) => num * 2);

      const workflow = mapReduce(singleArray, {
        map: doubleTask,
        reduce: (acc, current) => acc + current,
        initial: 0
      });

      const result = await run(workflow, null);
      expect(result).toBe(84); // 42 * 2
    });

    it('should work with complex data types', async () => {
      const users = [
        { id: 1, name: 'Alice', posts: 5 },
        { id: 2, name: 'Bob', posts: 3 },
        { id: 3, name: 'Charlie', posts: 8 }
      ];

      const extractPostsTask = defineTask(async (user: typeof users[0]) => {
        // await new Promise(resolve => setTimeout(resolve, 5)); // Removed for fake timer compatibility
        return user.posts;
      });

      const workflow = mapReduce(users, {
        map: extractPostsTask,
        reduce: (totalPosts, userPosts) => totalPosts + userPosts,
        initial: 0
      });

      const result = await run(workflow, null);

      expect(result).toBe(16); // 5 + 3 + 8
    });

    it('should work with string concatenation', async () => {
      const words = ['Hello', 'beautiful', 'world'];
      
      const uppercaseTask = defineTask(async (word: string) => word.toUpperCase());

      const workflow = mapReduce(words, {
        map: uppercaseTask,
        reduce: (sentence, word) => sentence ? `${sentence} ${word}` : word,
        initial: ''
      });

      const result = await run(workflow, null);
      expect(result).toBe('HELLO BEAUTIFUL WORLD');
    });

    it('should handle concurrency limits', async () => {
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
      let concurrentTasks = 0;
      let maxConcurrency = 0;

      const countingTask = defineTask(async (num: number) => {
        concurrentTasks++;
        maxConcurrency = Math.max(maxConcurrency, concurrentTasks);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        concurrentTasks--;
        return num;
      });

      const workflow = mapReduce(numbers, {
        map: countingTask,
        reduce: (acc, current) => acc + current,
        initial: 0,
        concurrency: 3
      });

      const result = await run(workflow, null);

      expect(result).toBe(36); // 1+2+3+4+5+6+7+8
      expect(maxConcurrency).toBeLessThanOrEqual(3);
    });

    it('should handle task failures gracefully', async () => {
      const numbers = [1, 2, 3, 4, 5];
      
      const failingTask = defineTask(async (num: number) => {
        if (num === 3) {
          throw new Error('Task failed for number 3');
        }
        return num * 2;
      });

      const workflow = mapReduce(numbers, {
        map: failingTask,
        reduce: (acc, current) => acc + current,
        initial: 0
      });

      await expect(run(workflow, null)).rejects.toThrow('Task failed');
    });
  });

  describe('filter', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should filter array based on async predicate', async () => {
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const isEvenTask = defineTask(async (num: number) => {
        await new Promise(resolve => setTimeout(resolve, 5));
        return num % 2 === 0;
      });

      const workflow = filter(isEvenTask);
      
      const result = await run(workflow, numbers);

      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should handle empty arrays', async () => {
      const emptyArray: number[] = [];
      
      const alwaysTrueTask = defineTask(async () => true);
      const workflow = filter(alwaysTrueTask);

      const result = await run(workflow, emptyArray);
      expect(result).toEqual([]);
    });

    it('should handle arrays where no items pass filter', async () => {
      const numbers = [1, 3, 5, 7, 9];
      
      const isEvenTask = defineTask(async (num: number) => num % 2 === 0);
      const workflow = filter(isEvenTask);

      const result = await run(workflow, numbers);
      expect(result).toEqual([]);
    });

    it('should handle arrays where all items pass filter', async () => {
      const numbers = [2, 4, 6, 8];
      
      const isEvenTask = defineTask(async (num: number) => num % 2 === 0);
      const workflow = filter(isEvenTask);

      const result = await run(workflow, numbers);
      expect(result).toEqual([2, 4, 6, 8]);
    });

    it('should work with complex data types', async () => {
      const users = [
        { id: 1, name: 'Alice', active: true },
        { id: 2, name: 'Bob', active: false },
        { id: 3, name: 'Charlie', active: true },
        { id: 4, name: 'David', active: false }
      ];

      const isActiveTask = defineTask(async (user: typeof users[0]) => {
        const ctx = getContext();
        await new Promise(resolve => setTimeout(resolve, 3));
        return user.active && ctx.filterCriteria === 'active';
      });

      const workflow = filter(isActiveTask);
      
      const result = await run(workflow, users);

      expect(result).toEqual([
        { id: 1, name: 'Alice', active: true },
        { id: 3, name: 'Charlie', active: true }
      ]);
    });

    it('should respect concurrency limits', async () => {
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8];
      let concurrentTasks = 0;
      let maxConcurrency = 0;

      const countingPredicateTask = defineTask(async (num: number) => {
        concurrentTasks++;
        maxConcurrency = Math.max(maxConcurrency, concurrentTasks);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        concurrentTasks--;
        return num % 2 === 0;
      });

      const workflow = filter(countingPredicateTask, { concurrency: 2 });
      
      const result = await run(workflow, numbers);

      expect(result).toEqual([2, 4, 6, 8]);
      expect(maxConcurrency).toBeLessThanOrEqual(2);
    });

    it('should handle predicate task failures', async () => {
      const numbers = [1, 2, 3, 4, 5];
      
      const failingPredicateTask = defineTask(async (num: number) => {
        if (num === 3) {
          throw new Error('Predicate failed for number 3');
        }
        return num % 2 === 0;
      });

      const workflow = filter(failingPredicateTask);

      await expect(run(workflow, numbers)).rejects.toThrow('Task failed');
    });

    it('should maintain original order of elements', async () => {
      const strings = ['apple', 'banana', 'cherry', 'date', 'elderberry'];
      
      const hasVowelTask = defineTask(async (str: string) => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10)); // Random delay
        return /[aeiou]/.test(str.charAt(0));
      });

      const workflow = filter(hasVowelTask);
      
      const result = await run(workflow, strings);

      expect(result).toEqual(['apple', 'elderberry']); // Maintains original order
    });
  });

  describe('groupBy', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should group items by key generated from async task', async () => {
      const numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      const getParityTask = defineTask(async (num: number) => {
        await new Promise(resolve => setTimeout(resolve, 2));
        return num % 2 === 0 ? 'even' : 'odd';
      });

      const workflow = groupBy(getParityTask);
      
      const result = await run(workflow, numbers);

      expect(result.get('even')).toEqual([2, 4, 6, 8, 10]);
      expect(result.get('odd')).toEqual([1, 3, 5, 7, 9]);
      expect(result.size).toBe(2);
    });

    it('should handle empty arrays', async () => {
      const emptyArray: string[] = [];
      
      const getFirstCharTask = defineTask(async (str: string) => str.charAt(0));
      const workflow = groupBy(getFirstCharTask);

      const result = await run(workflow, emptyArray);
      expect(result.size).toBe(0);
    });

    it('should handle arrays with single group', async () => {
      const numbers = [2, 4, 6, 8];
      
      const getParityTask = defineTask(async (num: number) => num % 2 === 0 ? 'even' : 'odd');
      const workflow = groupBy(getParityTask);

      const result = await run(workflow, numbers);
      expect(result.get('even')).toEqual([2, 4, 6, 8]);
      expect(result.get('odd')).toBeUndefined();
      expect(result.size).toBe(1);
    });

    it('should work with complex data types', async () => {
      const users = [
        { id: 1, name: 'Alice', department: 'Engineering' },
        { id: 2, name: 'Bob', department: 'Marketing' },
        { id: 3, name: 'Charlie', department: 'Engineering' },
        { id: 4, name: 'David', department: 'Sales' },
        { id: 5, name: 'Eve', department: 'Marketing' }
      ];

      const getDepartmentTask = defineTask(async (user: typeof users[0]) => {
        await new Promise(resolve => setTimeout(resolve, 1));
        return user.department;
      });

      const workflow = groupBy(getDepartmentTask);
      
      const result = await run(workflow, users);

      expect(result.get('Engineering')).toEqual([
        { id: 1, name: 'Alice', department: 'Engineering' },
        { id: 3, name: 'Charlie', department: 'Engineering' }
      ]);
      expect(result.get('Marketing')).toEqual([
        { id: 2, name: 'Bob', department: 'Marketing' },
        { id: 5, name: 'Eve', department: 'Marketing' }
      ]);
      expect(result.get('Sales')).toEqual([
        { id: 4, name: 'David', department: 'Sales' }
      ]);
      expect(result.size).toBe(3);
    });

    it('should handle numeric keys', async () => {
      const strings = ['a', 'bb', 'ccc', 'dd', 'eeeee', 'f'];
      
      const getLengthTask = defineTask(async (str: string) => str.length);
      const workflow = groupBy(getLengthTask);

      const result = await run(workflow, strings);
      expect(result.get(1)).toEqual(['a', 'f']);
      expect(result.get(2)).toEqual(['bb', 'dd']);
      expect(result.get(3)).toEqual(['ccc']);
      expect(result.get(5)).toEqual(['eeeee']);
      expect(result.size).toBe(4);
    });

    it('should respect concurrency limits', async () => {
      const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      let concurrentTasks = 0;
      let maxConcurrency = 0;

      const countingKeyTask = defineTask(async (str: string) => {
        concurrentTasks++;
        maxConcurrency = Math.max(maxConcurrency, concurrentTasks);
        
        await new Promise(resolve => setTimeout(resolve, 10));
        
        concurrentTasks--;
        return str.charCodeAt(0) % 2; // Group by ASCII code parity
      });

      const workflow = groupBy(countingKeyTask, { concurrency: 3 });
      
      const result = await run(workflow, items);

      expect(result.size).toBe(2);
      expect(maxConcurrency).toBeLessThanOrEqual(3);
    });

    it('should handle keying task failures', async () => {
      const items = ['apple', 'banana', 'cherry'];
      
      const failingKeyTask = defineTask(async (str: string) => {
        if (str === 'banana') {
          throw new Error('Keying failed for banana');
        }
        return str.charAt(0);
      });

      const workflow = groupBy(failingKeyTask);

      await expect(run(workflow, items)).rejects.toThrow('Task failed');
    });

    it('should maintain insertion order within groups', async () => {
      const numbers = [1, 3, 2, 5, 4, 7, 6, 9, 8];
      
      const getParityTask = defineTask(async (num: number) => num % 2 === 0 ? 'even' : 'odd');
      const workflow = groupBy(getParityTask);

      const result = await run(workflow, numbers);
      
      // Should maintain the order they appeared in original array
      expect(result.get('odd')).toEqual([1, 3, 5, 7, 9]);
      expect(result.get('even')).toEqual([2, 4, 6, 8]);
    });

    it('should handle duplicate keys correctly', async () => {
      const words = ['cat', 'car', 'dog', 'duck', 'cow'];
      
      const getFirstCharTask = defineTask(async (word: string) => word.charAt(0));
      const workflow = groupBy(getFirstCharTask);

      const result = await run(workflow, words);
      expect(result.get('c')).toEqual(['cat', 'car', 'cow']);
      expect(result.get('d')).toEqual(['dog', 'duck']);
      expect(result.size).toBe(2);
    });
  });

  describe('Integration tests', () => {
    const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

    it('should combine mapReduce with filter for complex processing', async () => {
      const transactions = [
        { id: 1, amount: 100, type: 'credit' },
        { id: 2, amount: 50, type: 'debit' },
        { id: 3, amount: 200, type: 'credit' },
        { id: 4, amount: 75, type: 'debit' },
        { id: 5, amount: 300, type: 'credit' }
      ];

      // First filter for credit transactions
      const isCreditTask = defineTask(async (transaction: typeof transactions[0]) => {
        return transaction.type === 'credit';
      });

      // Then sum up the amounts
      const getAmountTask = defineTask(async (transaction: typeof transactions[0]) => {
        return transaction.amount;
      });

      const filterWorkflow = filter(isCreditTask);
      const sumWorkflow = mapReduce([], {
        map: getAmountTask,
        reduce: (total, amount) => total + amount,
        initial: 0
      });

      // Combine the workflows
      const combinedWorkflow = defineTask(async (transactions: typeof transactions) => {
        const creditTransactions = await run(filterWorkflow, transactions);
        return await run(mapReduce(creditTransactions, {
          map: getAmountTask,
          reduce: (total, amount) => total + amount,
          initial: 0
        }), null);
      });

      const result = await run(combinedWorkflow, transactions);
      expect(result).toBe(600); // 100 + 200 + 300
    });

    it('should use groupBy with mapReduce for aggregation', async () => {
      const salesData = [
        { region: 'North', amount: 100 },
        { region: 'South', amount: 150 },
        { region: 'North', amount: 200 },
        { region: 'East', amount: 75 },
        { region: 'South', amount: 125 },
        { region: 'East', amount: 100 }
      ];

      const getRegionTask = defineTask(async (sale: typeof salesData[0]) => sale.region);
      const getAmountTask = defineTask(async (sale: typeof salesData[0]) => sale.amount);

      const complexWorkflow = defineTask(async (sales: typeof salesData) => {
        // Group by region
        const groupedByRegion = await run(groupBy(getRegionTask), sales);
        
        // Calculate totals for each region
        const regionTotals = new Map<string, number>();
        
        for (const [region, regionSales] of groupedByRegion.entries()) {
          const total = await run(mapReduce(regionSales, {
            map: getAmountTask,
            reduce: (sum, amount) => sum + amount,
            initial: 0
          }), null);
          regionTotals.set(region, total);
        }
        
        return regionTotals;
      });

      const result = await run(complexWorkflow, salesData);
      
      expect(result.get('North')).toBe(300); // 100 + 200
      expect(result.get('South')).toBe(275); // 150 + 125
      expect(result.get('East')).toBe(175);  // 75 + 100
      expect(result.size).toBe(3);
    });
  });
});
