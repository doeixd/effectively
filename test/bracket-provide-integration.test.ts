import { describe, it, expect } from 'vitest';
import {
  createContext,
  defineTask,
  getContext,
  type BaseContext
} from '../src/run';
import { bracket } from '../src/bracket';

interface TestContext extends BaseContext {
  db?: string;
  cache?: string;
}

const testContextDefaults: Omit<TestContext, 'scope'> = {};

describe('Bracket and Provide Integration', () => {
  const { run, defineTask: ctxDefineTask, getContext: ctxGetContext } = createContext<TestContext>(testContextDefaults);

  it('should properly provide resources from bracket to use tasks', async () => {
    const logs: string[] = [];

    // Task that uses provided resources
    const useTask = ctxDefineTask(async (input: string) => {
      const context = ctxGetContext();
      logs.push(`useTask called with: ${input}`);
      logs.push(`db available: ${!!context.db}`);
      logs.push(`cache available: ${!!context.cache}`);
      
      // These should be available due to the provide call in bracket
      expect(context.db).toBe('db-connection');
      expect(context.cache).toBe('cache-connection');
      
      return `processed-${input}`;
    });

    // Bracket that provides resources
    const resourceBracket = bracket({
      acquire: async () => {
        logs.push('acquiring resources');
        return {
          db: 'db-connection',
          cache: 'cache-connection'
        };
      },
      use: async (context, value) => {
        logs.push('using resources');
        // This should properly provide the resources to useTask
        return useTask(context, 'test-data');
      },
      release: async (resources) => {
        logs.push('releasing resources');
      },
      merge: (context, resource) => ({ ...context, ...resource })
    });

    const result = await run(resourceBracket, undefined);
    
    expect(result).toBe('processed-test-data');
    expect(logs).toEqual([
      'acquiring resources',
      'using resources',
      'useTask called with: test-data',
      'db available: true',
      'cache available: true',
      'releasing resources'
    ]);
  });

  it('should handle nested bracket provides correctly', async () => {
    const logs: string[] = [];

    const innerTask = ctxDefineTask(async (input: string) => {
      const context = ctxGetContext() as TestContext & { config?: string };
      logs.push(`innerTask: db=${context.db}, cache=${context.cache}, config=${context.config}`);
      
      expect(context.db).toBe('db-connection');
      expect(context.cache).toBe('cache-connection');
      expect(context.config).toBe('app-config');
      
      return `inner-${input}`;
    });

    const outerBracket = bracket({
      acquire: async () => {
        logs.push('acquiring outer resources');
        return { db: 'db-connection', cache: 'cache-connection' };
      },
      use: async (outerContext, outerValue) => {
        logs.push('using outer resources');
        
        // Nested bracket with additional resources
        const innerBracket = bracket({
          acquire: async () => {
            logs.push('acquiring inner resources');
            return { config: 'app-config' };
          },
          use: async (innerContext, innerValue) => {
            logs.push('using inner resources');
            return innerTask(innerContext, 'nested-data');
          },
          release: async (innerResources) => {
            logs.push('releasing inner resources');
          },
          merge: (context, resource) => ({ ...context, ...resource })
        });
        
        return innerBracket(outerContext, outerValue);
      },
      release: async (outerResources) => {
        logs.push('releasing outer resources');
      },
      merge: (context, resource) => ({ ...context, ...resource })
    });

    const result = await run(outerBracket, undefined);
    
    expect(result).toBe('inner-nested-data');
    expect(logs).toEqual([
      'acquiring outer resources',
      'using outer resources',
      'acquiring inner resources',
      'using inner resources',
      'innerTask: db=db-connection, cache=cache-connection, config=app-config',
      'releasing inner resources',
      'releasing outer resources'
    ]);
  });
});
