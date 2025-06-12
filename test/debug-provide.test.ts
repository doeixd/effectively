import { describe, it, expect } from 'vitest';
import {
  createContext,
  defineTask,
  getContext,
  provide,
  type BaseContext
} from '../src/run';

interface TestContext extends BaseContext {
  db?: string;
  cache?: string;
}

const testContextDefaults: Omit<TestContext, 'scope'> = {};

describe('Debug Provide', () => {
  const { run, provide: ctxProvide, defineTask: ctxDefineTask, getContext: ctxGetContext } = createContext<TestContext>(testContextDefaults);

  it('should work with context-specific provide', async () => {
    const logs: string[] = [];

    const useEnhancedContext = ctxDefineTask(async (input: string) => {
      const context = ctxGetContext();
      logs.push(`db available: ${!!context.db}`);
      logs.push(`cache available: ${!!context.cache}`);
      return `processed-${input}`;
    });

    const taskWithProvide = ctxDefineTask(async (input: string) => {
      logs.push('before provide');
      
      // Use context-specific provide instead of global
      const result = await ctxProvide(
        {
          db: 'db-connection',
          cache: 'cache-connection'
        },
        async () => {
          logs.push('inside provide');
          const ctx = ctxGetContext();
          return useEnhancedContext(ctx, input);
        }
      );
      
      logs.push('after provide');
      return result;
    });

    const result = await run(taskWithProvide, 'test-data');
    
    expect(result).toBe('processed-test-data');
    console.log('Logs:', logs);
  });

  it('should work with global provide', async () => {
    const logs: string[] = [];

    const useEnhancedContext = ctxDefineTask(async (input: string) => {
      const context = ctxGetContext();
      logs.push(`db available: ${!!context.db}`);
      logs.push(`cache available: ${!!context.cache}`);
      return `processed-${input}`;
    });

    const taskWithProvide = ctxDefineTask(async (input: string) => {
      logs.push('before global provide');
      
      // Use global provide - this should work with our fix
      const result = await provide(
        {
          db: 'db-connection',
          cache: 'cache-connection'
        },
        async () => {
          logs.push('inside global provide');
          const ctx = ctxGetContext();
          return useEnhancedContext(ctx, input);
        }
      );
      
      logs.push('after global provide');
      return result;
    });

    const result = await run(taskWithProvide, 'test-data');
    
    expect(result).toBe('processed-test-data');
    console.log('Global Logs:', logs);
  });
});
