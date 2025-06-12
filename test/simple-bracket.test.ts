import { describe, it, expect } from 'vitest';
import {
  createContext,
  defineTask,
  run,
  type BaseContext
} from '../src/run';

interface TestContext extends BaseContext {
  logs: string[];
}

const testContextDefaults: Omit<TestContext, 'scope'> = {
  logs: []
};

describe('Simple Bracket Test', () => {
  const { run, defineTask, getContext } = createContext<TestContext>(testContextDefaults);

  it('should work with manual bracket pattern', async () => {
    let resource: string | undefined;
    let released = false;

    const manualBracket = defineTask(async (input: string) => {
      const context = getContext();
      
      try {
        // Acquire
        resource = `resource-${input}`;
        context.logs.push(`acquired: ${resource}`);
        
        // Use
        const result = `used-${resource}`;
        context.logs.push(`used: ${resource}`);
        
        return result;
      } finally {
        // Release
        if (resource) {
          context.logs.push(`released: ${resource}`);
          released = true;
        }
      }
    });

    const result = await run(manualBracket, 'test');
    
    expect(result).toBe('used-resource-test');
    expect(released).toBe(true);
    
    // Check context was accessible
    const finalContext = testContextDefaults;
    expect(finalContext.logs).toEqual([
      'acquired: resource-test',
      'used: resource-test', 
      'released: resource-test'
    ]);
  });
});
