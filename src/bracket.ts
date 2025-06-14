import type { Task, BaseContext, Scope } from "./run";
import { defineTask, getContext, provide } from "./run";

/**
 * A type representing a reusable resource definition, encapsulating the logic for
 * acquiring, releasing, and merging a resource into the context. This pattern
 * promotes reusability and cleans up the call site for `withResources`.
 *
 * @template C The context type.
 * @template R The type of the resource.
 * @template V The input value type for the acquire task.
 * @template K The key under which the resource will be merged into the context.
 */
export interface ResourceDefinition<
  C extends BaseContext,
  R,
  V,
  K extends string,
> {
  acquire: Task<C, V, R>;
  release: Task<C, R, void>;
  merge: (context: C, resource: R) => C & { [P in K]: R };
}

/**
 * A helper to create a reusable resource definition for use with `withResources`.
 *
 * @param key The key to use when merging the resource into the context.
 * @param acquire The task to acquire the resource.
 * @param release The task to release the resource.
 * @returns A `ResourceDefinition` object, which can be passed to `withResources`.
 */
export function createResource<C extends BaseContext, R, V, K extends string>(
  key: K,
  acquire: Task<C, V, R>,
  release: Task<C, R, void>,
): ResourceDefinition<C, R, V, K> {
  return {
    acquire,
    release,
    merge: mergeIntoContext(key),
  };
}

/**
 * Configuration for the `withResource` (bracket) function.
 */
export interface BracketConfig<C extends BaseContext, R, V, U> {
  acquire: Task<C, V, R>;
  use: Task<C & Record<string, any>, V, U>;
  release: Task<C, R, void>;
  merge: (context: C, resource: R) => C & Record<string, any>;
}

/**
 * Creates a task that implements the acquire-use-release pattern, ensuring
 * a resource is properly cleaned up even if errors occur during its use.
 * This is the core resource management utility of the library.
 *
 * @param config The bracket configuration object.
 * @returns A new `Task` that encapsulates the entire resource lifecycle.
 *
 * @example
 * ```typescript
 * const withDbConnection = withResource({
 *   acquire: connectToDatabase,
 *   use: performUserQuery,
 *   release: disconnectFromDatabase,
 *   merge: mergeIntoContext('db') // Using the helper for readability
 * });
 *
 * const user = await run(withDbConnection, 'user-123');
 * ```
 */
export function withResource<C extends { scope: Scope }, R, V, U>(
  config: BracketConfig<C, R, V, U>,
): Task<C, V, U> {
  const bracketTask = defineTask<C, V, U>(async (value) => {
    const context = getContext<C>();
    let resource: R | undefined;
    let useError: unknown;

    try {
      resource = await config.acquire(context, value);
      const enhancedContext = config.merge(context, resource);

      // Separate the new properties from the core context to provide them.
      const { scope, ...overrides } = enhancedContext;

      // Use `provide` to make the enhanced context available to the `use` task.
      return await provide(overrides, () => {
        // `getContext` inside `config.use` will now resolve to the enhanced context.
        const currentContext = getContext<typeof enhancedContext>();
        return config.use(currentContext, value);
      });
    } catch (err) {
      useError = err;
      throw err;
    } finally {
      if (resource !== undefined) {
        try {
          await config.release(context, resource);
        } catch (releaseError) {
          if (useError !== undefined) {
            throw new AggregateError(
              [useError, releaseError],
              'An error occurred during the "use" phase, and a subsequent error occurred during the "release" phase.',
            );
          }
          throw releaseError;
        }
      }
    }
  });

  Object.defineProperty(bracketTask, "name", {
    value: `withResource(${config.acquire.name || "acquire"} -> ${config.use.name || "use"})`,
    configurable: true,
  });

  return bracketTask;
}

/** The raw `bracket` function. `withResource` is the recommended, more readable alias. */
export const bracket = withResource;

export const DisposeSymbol = Symbol.for("Symbol.dispose");
export const AsyncDisposeSymbol = Symbol.for("Symbol.asyncDispose");

export interface Disposable {
  [DisposeSymbol](): void;
}
export interface AsyncDisposable {
  [AsyncDisposeSymbol](): Promise<void>;
}

export function isDisposable(value: unknown): value is Disposable {
  return (
    !!value &&
    typeof value === "object" &&
    DisposeSymbol in value &&
    typeof (value as any)[DisposeSymbol] === "function"
  );
}

export function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  return (
    !!value &&
    typeof value === "object" &&
    AsyncDisposeSymbol in value &&
    typeof (value as any)[AsyncDisposeSymbol] === "function"
  );
}

/**
 * A version of `withResource` for resources that implement the standard `Disposable`
 * or `AsyncDisposable` interface (from the TC39 Explicit Resource Management proposal).
 * The `release` logic is handled automatically by calling `[Symbol.dispose]` or `[Symbol.asyncDispose]`.
 *
 * @param config Configuration with `acquire`, `use`, and `merge`.
 * @returns A task that manages the disposable resource.
 */
export function withDisposableResource<
  C extends { scope: Scope },
  R extends Disposable | AsyncDisposable,
  V,
  U,
>(config: {
  acquire: Task<C, V, R>;
  use: Task<C & Record<string, any>, V, U>;
  merge: (context: C, resource: R) => C & Record<string, any>;
}): Task<C, V, U> {
  const release = defineTask<C, R, void>(async (resource) => {
    if (isAsyncDisposable(resource)) {
      await resource[AsyncDisposeSymbol]();
    } else if (isDisposable(resource)) {
      resource[DisposeSymbol]();
    } else {
      throw new TypeError(
        "Resource provided to withDisposableResource is not disposable.",
      );
    }
  });

  return withResource({ ...config, release });
}

/** The raw `bracketDisposable` function. `withDisposableResource` is the recommended alias. */
export const bracketDisposable = withDisposableResource;

/**
 * Manages multiple resources for a single `use` task, ensuring all are acquired
 * before use and all are released afterward, even in case of errors. Resources are
 * released in the reverse order of their acquisition.
 *
 * @param resources An array of `ResourceDefinition` objects.
 * @param use The task to execute once all resources have been acquired.
 * @returns A task that encapsulates the entire multi-resource lifecycle.
 */
export function withResources<C extends { scope: Scope }, V, U>(
  resources: Array<ResourceDefinition<C, any, V, any>>,
  use: Task<any, V, U>,
): Task<C, V, U> {
  return defineTask<C, V, U>(async (value) => {
    const context = getContext<C>();
    const acquired: Array<{ resource: any; release: Task<C, any, void> }> = [];
    let currentContext: any = context;
    let useError: unknown;

    try {
      for (const config of resources) {
        const resource = await config.acquire(currentContext, value);
        acquired.push({ resource, release: config.release });
        currentContext = config.merge(currentContext, resource);
      }

      // Correctly provide the fully merged context to the `use` task.
      const { scope, ...overrides } = currentContext;
      return await provide(overrides, () => {
        const finalContext = getContext<any>();
        return use(finalContext, value);
      });
    } catch (err) {
      useError = err;
      throw err;
    } finally {
      const releaseErrors: unknown[] = [];
      for (let i = acquired.length - 1; i >= 0; i--) {
        const { resource, release } = acquired[i];
        try {
          await release(context, resource);
        } catch (releaseError) {
          releaseErrors.push(releaseError);
        }
      }

      if (releaseErrors.length > 0) {
        if (useError !== undefined) {
          throw new AggregateError(
            [useError, ...releaseErrors],
            "Multiple errors during use and resource cleanup.",
          );
        } else if (releaseErrors.length === 1) {
          throw releaseErrors[0];
        } else {
          throw new AggregateError(
            releaseErrors,
            "Multiple errors during resource cleanup",
          );
        }
      }
    }
  });
}

/** The raw `bracketMany` function. `withResources` is the recommended alias. */
export const bracketMany = withResources;

// =================================================================
// Section: Helpers and Aliases
// =================================================================

/**
 * **Helper:** Creates a `merge` function for `withResource` that injects the resource
 * into the context under a specified key. This reduces boilerplate and improves readability.
 *
 * @param key The key under which to store the resource in the context.
 *
 * @example
 * ```typescript
 * withResource({
 *   acquire: getDb,
 *   use: useDb,
 *   release: closeDb,
 *   merge: mergeIntoContext('db') // Instead of: (ctx, db) => ({ ...ctx, db })
 * })
 * ```
 */
export function mergeIntoContext<C extends BaseContext, R, K extends string>(
  key: K,
): (context: C, resource: R) => C & { [P in K]: R } {
  return (context, resource) =>
    ({
      ...context,
      [key]: resource,
    }) as C & { [P in K]: R };
}

/**
 * **Helper:** Adapts an object with a specific cleanup method (like `.close()` or `.disconnect()`)
 * to the `AsyncDisposable` interface, making it compatible with `withDisposableResource`.
 *
 * @param resource The resource object to adapt.
 * @param cleanupMethodName The name of the asynchronous cleanup method on the resource.
 * @returns The original resource, now augmented with the `[Symbol.asyncDispose]` method.
 */
export function asAsyncDisposable<T extends object, K extends keyof T>(
  resource: T,
  cleanupMethodName: K,
): T & AsyncDisposable {
  const cleanupMethod = resource[cleanupMethodName];
  if (typeof cleanupMethod !== "function") {
    throw new TypeError(
      `Method '${String(cleanupMethodName)}' not found or not a function on the provided resource.`,
    );
  }

  return Object.assign(resource, {
    [AsyncDisposeSymbol]: () => Promise.resolve(cleanupMethod.call(resource)),
  });
}

// =================================================================
// Section: Context-Bound Tools
// =================================================================

/**
 * Creates context-specific resource management functions for a given context type.
 * This is useful for large applications with a well-defined context, as it provides
 * stronger, built-in type inference for all bracket operations.
 *
 * @param contextTools The context tools returned from `createContext`.
 * @returns An object with context-specific resource management functions.
 */
export function createBracketTools<C extends BaseContext>(contextTools: {
  defineTask: <V, R>(fn: (value: V) => Promise<R>) => Task<C, V, R>;
  getContext: () => C;
  provide: <R>(
    overrides: Partial<Omit<C, "scope">>,
    fn: () => Promise<R>,
  ) => Promise<R>;
}) {
  const { defineTask: define, getContext: get, provide: prov } = contextTools;

  function localWithResource<R, V, U>(
    config: BracketConfig<C, R, V, U>,
  ): Task<C, V, U> {
    return define(async (value) => {
      const context = get();
      let resource: R | undefined;
      let useError: unknown;

      try {
        resource = await config.acquire(context, value);
        const enhancedContext = config.merge(context, resource);
        const { scope, ...overrides } = enhancedContext;

        return await prov(overrides, () => {
          const currentContext = get() as typeof enhancedContext;
          return config.use(currentContext, value);
        });
      } catch (err) {
        useError = err;
        throw err;
      } finally {
        if (resource !== undefined) {
          try {
            await config.release(context, resource);
          } catch (releaseError) {
            if (useError !== undefined) {
              throw new AggregateError(
                [useError, releaseError],
                "Error during both use and release phases.",
              );
            }
            throw releaseError;
          }
        }
      }
    });
  }

  function localWithDisposableResource<
    R extends Disposable | AsyncDisposable,
    V,
    U,
  >(config: {
    acquire: Task<C, V, R>;
    use: Task<C & Record<string, any>, V, U>;
    merge: (context: C, resource: R) => C & Record<string, any>;
  }): Task<C, V, U> {
    const release = define(async (resource: R) => {
      if (isAsyncDisposable(resource)) await resource[AsyncDisposeSymbol]();
      else if (isDisposable(resource)) resource[DisposeSymbol]();
      else throw new Error("Resource is not disposable");
    });
    return localWithResource({ ...config, release });
  }

  function localWithResources<V, U>(
    resources: Array<ResourceDefinition<C, any, V, any>>,
    use: Task<any, V, U>,
  ): Task<C, V, U> {
    return define(async (value) => {
      const context = get();
      const acquired: Array<{ resource: any; release: Task<C, any, void> }> =
        [];
      let currentContext: any = context;
      let useError: unknown;

      try {
        for (const config of resources) {
          const resource = await config.acquire(currentContext, value);
          acquired.push({ resource, release: config.release });
          currentContext = config.merge(currentContext, resource);
        }

        const { scope, ...overrides } = currentContext;
        return await prov(overrides, () => {
          const finalContext = get() as any;
          return use(finalContext, value);
        });
      } catch (err) {
        useError = err;
        throw err;
      } finally {
        const releaseErrors: unknown[] = [];
        for (let i = acquired.length - 1; i >= 0; i--) {
          const { resource, release } = acquired[i];
          try {
            await release(context, resource);
          } catch (releaseError) {
            releaseErrors.push(releaseError);
          }
        }
        if (releaseErrors.length > 0) {
          if (useError !== undefined) {
            throw new AggregateError(
              [useError, ...releaseErrors],
              "Multiple errors during use and resource cleanup.",
            );
          } else if (releaseErrors.length === 1) {
            throw releaseErrors[0];
          } else {
            throw new AggregateError(
              releaseErrors,
              "Multiple errors during resource cleanup",
            );
          }
        }
      }
    });
  }

  return {
    withResource: localWithResource,
    withDisposableResource: localWithDisposableResource,
    withResources: localWithResources,
  };
}

/**
 * An example implementation of a resource that can be managed by the bracket pattern.
 * It implements the `AsyncDisposable` interface for automatic cleanup with `withDisposableResource`.
 */
export class DatabaseConnection implements AsyncDisposable {
  private _connected = false;

  constructor(public connectionString: string) {}

  async connect(): Promise<this> {
    if (!this._connected) {
      console.log(`Connecting to ${this.connectionString}...`);
      this._connected = true;
    }
    return this;
  }

  async query(sql: string, params?: any[]): Promise<any> {
    if (!this._connected) throw new Error("Connection is closed");
    console.log(`Executing query: ${sql}`, params);
    return { rows: [{ id: 1, name: "Example" }] };
  }

  async close(): Promise<void> {
    if (this._connected) {
      console.log("Closing database connection");
      this._connected = false;
    }
  }

  async [AsyncDisposeSymbol](): Promise<void> {
    await this.close();
  }
}
