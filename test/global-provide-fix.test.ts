import { describe, it, expect } from 'vitest';
import {
  createContext,
  defineTask,
  getContext,
  provide,
  run,
  type BaseContext
} from '../src/run';

interface TestContext extends BaseContext {
  db?: string;
  cache?: string;
}

const testContextDefaults: Omit<TestContext, 'scope'> = {};

describe('Global Provide Function Fix', () => {
  it('should properly enhance context when provide is called within existing context', async () => {
    const logs: string[] = [];

    // Task that checks for enhanced context - using GLOBAL functions
    const useEnhancedContext = defineTask(async (input: string) => {
      const context = getContext<TestContext>();
      logs.push(`db available: ${!!context.db}`);
      logs.push(`cache available: ${!!context.cache}`);
      
      // These should be available due to the provide call
      expect(context.db).toBe('db-connection');
      expect(context.cache).toBe('cache-connection');
      
      return `processed-${input}`;
    });

    // Task that uses provide to enhance context - using GLOBAL functions
    const taskWithProvide = defineTask(async (input: string) => {
      logs.push('before provide');
      
      // This is the key test - provide should work within an existing context
      const result = await provide(
        {
          db: 'db-connection',
          cache: 'cache-connection'
        },
        async () => {
          logs.push('inside provide');
          return run(useEnhancedContext, input);
        }
      );
      
      logs.push('after provide');
      return result;
    });

    const result = await run(taskWithProvide, 'test-data');
    
    expect(result).toBe('processed-test-data');
    expect(logs).toEqual([
      'before provide',
      'inside provide',
      'db available: true',
      'cache available: true',
      'after provide'
    ]);
  });

  it('should work with nested provide calls', async () => {
    const logs: string[] = [];

    const innerTask = defineTask(async (input: string) => {
      const context = getContext<TestContext & { config?: string }>();
      logs.push(`context: db=${!!context.db}, cache=${!!context.cache}, config=${!!context.config}`);
      
      expect(context.db).toBe('db-connection');
      expect(context.cache).toBe('cache-connection');
      expect(context.config).toBe('app-config');
      
      return `inner-${input}`;
    });

    const outerTask = defineTask(async (input: string) => {
      return provide(
        { db: 'db-connection' },
        async () => {
          return provide(
            { cache: 'cache-connection', config: 'app-config' },
            async () => {
              return run(innerTask, input);
            }
          );
        }
      );
    });

    const result = await run(outerTask, 'nested-data');
    
    expect(result).toBe('inner-nested-data');
    expect(logs).toEqual([
      'context: db=true, cache=true, config=true'
    ]);
  });
});
