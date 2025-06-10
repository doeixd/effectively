import type { Task, Scope } from './run';
import { defineTask, getContext } from './run';

/**
 * Configuration for the bracket function.
 * 
 * @template C The context type
 * @template R The resource type to be acquired and released
 * @template V The input value type for the workflow
 * @template U The output value type from the use workflow
 */
export interface BracketConfig<C extends { scope: Scope }, R, V, U> {
  /**
   * Task that acquires the resource.
   * This task is executed first and its result is made available to the use workflow.
   */
  acquire: Task<C, V, R>;
  
  /**
   * The main workflow that uses the acquired resource.
   * This workflow runs with an enhanced context that includes the resource.
   */
  use: Task<C & Record<string, any>, V, U>;
  
  /**
   * Task that releases the resource.
   * This task is ALWAYS executed, even if the use workflow throws an error.
   * It receives the acquired resource as its input.
   */
  release: Task<C, R, void>;
  
  /**
   * Function to merge the acquired resource into the context.
   * This creates the enhanced context for the use workflow.
   * 
   * @param context The original context
   * @param resource The acquired resource
   * @returns The enhanced context with the resource included
   */
  merge: (context: C, resource: R) => C & Record<string, any>;
}

/**
 * Creates a task that implements the acquire-use-release pattern for resource management.
 * 
 * This function ensures that resources are properly cleaned up even if errors occur,
 * similar to try-finally but designed for async workflows.
 * 
 * @template C The context type
 * @template R The resource type
 * @template V The input value type
 * @template U The output value type
 * @param config The bracket configuration
 * @returns A task that manages the resource lifecycle
 * 
 * @example
 * ```typescript
 * const withDbConnection = bracket({
 *   acquire: acquireDbConnection,
 *   use: performQueries,
 *   release: releaseDbConnection,
 *   merge: (ctx, conn) => ({ ...ctx, db: conn })
 * });
 * ```
 */
export function bracket<C extends { scope: Scope }, R, V, U>(
  config: BracketConfig<C, R, V, U>
): Task<C, V, U> {
  return defineTask<C, V, U>(async (value) => {
    const context = getContext<C>();
    let resource: R | undefined;
    let error: unknown;
    
    try {
      // Acquire the resource
      resource = await config.acquire(context, value);
      
      // Create enhanced context with the resource
      const enhancedContext = config.merge(context, resource);
      
      // Execute the use workflow with enhanced context
      // We need to manually set up the context for the inner workflow
      const { run } = await import('./context');
      
      // Run the use workflow in a sub-context
      return await run(
        config.use,
        value,
        {
          overrides: enhancedContext as any,
          parentSignal: context.scope.signal
        }
      );
    } catch (err) {
      error = err;
      throw err;
    } finally {
      // Always release the resource if it was acquired
      if (resource !== undefined) {
        try {
          await config.release(context, resource);
        } catch (releaseError) {
          // If we already have an error from the use phase, log the release error
          // but re-throw the original error
          if (error !== undefined) {
            console.error('Error during resource release:', releaseError);
          } else {
            // If no prior error, throw the release error
            throw releaseError;
          }
        }
      }
    }
  });
}

/**
 * Symbol for disposable resources in the explicit resource management proposal.
 */
export const DisposeSymbol = Symbol.for('Symbol.dispose');
export const AsyncDisposeSymbol = Symbol.for('Symbol.asyncDispose');

/**
 * Interface for synchronous disposable resources.
 * Follows the TC39 Explicit Resource Management proposal.
 */
export interface Disposable {
  [DisposeSymbol](): void;
}

/**
 * Interface for asynchronous disposable resources.
 * Follows the TC39 Explicit Resource Management proposal.
 */
export interface AsyncDisposable {
  [AsyncDisposeSymbol](): Promise<void>;
}

/**
 * Type guard to check if a value is a synchronous disposable.
 */
export function isDisposable(value: unknown): value is Disposable {
  return (
    value !== null &&
    typeof value === 'object' &&
    DisposeSymbol in value &&
    typeof (value as any)[DisposeSymbol] === 'function'
  );
}

/**
 * Type guard to check if a value is an asynchronous disposable.
 */
export function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  return (
    value !== null &&
    typeof value === 'object' &&
    AsyncDisposeSymbol in value &&
    typeof (value as any)[AsyncDisposeSymbol] === 'function'
  );
}

/**
 * Creates a bracket configuration for a disposable resource.
 * This adapter allows using the TC39 Explicit Resource Management proposal
 * with the bracket pattern.
 * 
 * @template C The context type
 * @template R The resource type (must be Disposable or AsyncDisposable)
 * @template V The input value type
 * @template U The output value type
 * @param acquire Task that acquires the disposable resource
 * @param use The workflow that uses the resource
 * @param merge Function to merge the resource into context
 * @returns A task that manages the disposable resource
 * 
 * @example
 * ```typescript
 * class DbConnection implements AsyncDisposable {
 *   async [Symbol.asyncDispose]() {
 *     await this.close();
 *   }
 * }
 * 
 * const withDb = bracketDisposable({
 *   acquire: async () => new DbConnection(),
 *   use: performQueries,
 *   merge: (ctx, db) => ({ ...ctx, db })
 * });
 * ```
 */
export function bracketDisposable<
  C extends { scope: Scope },
  R extends Disposable | AsyncDisposable,
  V,
  U
>(config: {
  acquire: Task<C, V, R>;
  use: Task<C & Record<string, any>, V, U>;
  merge: (context: C, resource: R) => C & Record<string, any>;
}): Task<C, V, U> {
  // Create a release task that calls the dispose method
  const release = defineTask<C, R, void>(async (resource) => {
    if (isAsyncDisposable(resource)) {
      await resource[AsyncDisposeSymbol]();
    } else if (isDisposable(resource)) {
      resource[DisposeSymbol]();
    } else {
      throw new Error('Resource is not disposable');
    }
  });
  
  return bracket({
    ...config,
    release
  });
}

/**
 * Creates a task that uses multiple resources with automatic cleanup.
 * All resources are acquired in order and released in reverse order.
 * 
 * @template C The context type
 * @template V The input value type
 * @template U The output value type
 * @param resources Array of resource configurations
 * @param use The workflow that uses all resources
 * @returns A task that manages multiple resources
 * 
 * @example
 * ```typescript
 * const withResources = bracketMany([
 *   {
 *     acquire: acquireDbConnection,
 *     release: releaseDbConnection,
 *     merge: (ctx, db) => ({ ...ctx, db })
 *   },
 *   {
 *     acquire: acquireCache,
 *     release: releaseCache,
 *     merge: (ctx, cache) => ({ ...ctx, cache })
 *   }
 * ], performComplexOperation);
 * ```
 */
export function bracketMany<C extends { scope: Scope }, V, U>(
  resources: Array<{
    acquire: Task<C, any, any>;
    release: Task<C, any, void>;
    merge: (context: any, resource: any) => any;
  }>,
  use: Task<any, V, U>
): Task<C, V, U> {
  return defineTask<C, V, U>(async (value) => {
    const context = getContext<C>();
    const acquired: Array<{ resource: any; release: Task<C, any, void> }> = [];
    let currentContext: any = context;
    let error: unknown;
    
    try {
      // Acquire all resources in order
      for (const config of resources) {
        const resource = await config.acquire(currentContext, value);
        acquired.push({ resource, release: config.release });
        currentContext = config.merge(currentContext, resource);
      }
      
      // Execute the use workflow with all resources
      const { run } = await import('./context');
      return await run(
        use,
        value,
        {
          overrides: currentContext,
          parentSignal: context.scope.signal
        }
      );
    } catch (err) {
      error = err;
      throw err;
    } finally {
      // Release all resources in reverse order
      const releaseErrors: unknown[] = [];
      
      for (let i = acquired.length - 1; i >= 0; i--) {
        const { resource, release } = acquired[i];
        try {
          await release(context, resource);
        } catch (releaseError) {
          releaseErrors.push(releaseError);
        }
      }
      
      // If we have release errors and no prior error, throw them
      if (releaseErrors.length > 0 && error === undefined) {
        if (releaseErrors.length === 1) {
          throw releaseErrors[0];
        } else {
          throw new AggregateError(releaseErrors, 'Multiple errors during resource cleanup');
        }
      } else if (releaseErrors.length > 0) {
        // Log release errors if we already have a main error
        console.error('Errors during resource cleanup:', releaseErrors);
      }
    }
  });
}

/**
 * Utility to create a disposable wrapper around any value with a cleanup function.
 * 
 * @template T The type of the wrapped value
 * @param value The value to wrap
 * @param dispose The cleanup function
 * @returns A disposable wrapper
 * 
 * @example
 * ```typescript
 * const file = makeDisposable(
 *   await fs.open('file.txt'),
 *   async (handle) => await handle.close()
 * );
 * 
 * // Can be used with using statement when available
 * // using file = makeDisposable(...);
 * ```
 */
export function makeDisposable<T>(
  value: T,
  dispose: (value: T) => void
): T & Disposable {
  return Object.assign(value, {
    [DisposeSymbol]: () => dispose(value)
  });
}

/**
 * Utility to create an async disposable wrapper.
 * 
 * @template T The type of the wrapped value
 * @param value The value to wrap
 * @param dispose The async cleanup function
 * @returns An async disposable wrapper
 */
export function makeAsyncDisposable<T>(
  value: T,
  dispose: (value: T) => Promise<void>
): T & AsyncDisposable {
  return Object.assign(value, {
    [AsyncDisposeSymbol]: () => dispose(value)
  });
}

/**
 * Example implementation of a disposable database connection.
 * This demonstrates how to implement the Disposable interface.
 */
export class DisposableConnection implements AsyncDisposable {
  private connected = true;
  
  constructor(private connectionString: string) {}
  
  async query(sql: string, params?: any[]): Promise<any> {
    if (!this.connected) {
      throw new Error('Connection is closed');
    }
    // Simulate query execution
    console.log(`Executing query: ${sql}`, params);
    return { rows: [] };
  }
  
  async close(): Promise<void> {
    if (this.connected) {
      console.log('Closing database connection');
      this.connected = false;
    }
  }
  
  async [AsyncDisposeSymbol](): Promise<void> {
    await this.close();
  }
}