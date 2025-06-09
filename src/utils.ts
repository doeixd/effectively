/**
 * @module
 * This module provides a collection of higher-order functions and utilities
 * for creating, composing, and enhancing Tasks. These tools enable patterns
 * like retries, timeouts, batching, rate-limiting, and robust error handling.
 */

import { Result, ok, err } from 'neverthrow';
import {
  type Task,
  type Scope,
  type Logger,
  noopLogger,
  defineTask,
  getContext,
  isBacktrackSignal,
  createContext, // Assuming createContext provides a way to get the unctx instance or a new run function
  getContextOrUndefined,
} from './run'; // Assuming core types are in './run'

// --- Task Composition Utilities ---

/**
 * Transforms the successful output of a task into a new task.
 * This is the primary way to chain dependent asynchronous operations.
 * If the first task fails, the second task is not executed.
 *
 * @param task The initial task to execute.
 * @param f A function that takes the successful result of the first task and returns a new `Task`.
 * @returns A new `Task` representing the complete chained operation.
 *
 * @example
 * ```typescript
 * const fetchUser = defineTask((id: string) => api.users.get(id));
 * const fetchPosts = defineTask((user: User) => api.posts.forUser(user.id));
 *
 * // First fetch the user, andThen use the user object to fetch their posts.
 * const workflow = andThen(fetchUser, (user) => fetchPosts);
 *
 * const posts = await run(workflow, 'user-123');
 * ```
 */
export function andThen<C extends { scope: Scope }, In, A, B>(
  task: Task<C, In, A>,
  f: (value: A) => Task<C, A, B>
): Task<C, In, B> {
  const composedTask: Task<C, In, B> = async (context, inputValue) => {
    const intermediateResult = await task(context, inputValue);
    const nextTask = f(intermediateResult);
    // The input to the next task is the successful value from the first
    return nextTask(context, intermediateResult);
  };
  Object.defineProperty(composedTask, 'name', { value: `${task.name || 'task'}.andThen` });
  return composedTask;
}

/**
 * Transforms the successful output of a task using a mapping function.
 * Useful for synchronous data transformation or extraction.
 *
 * @param task The task whose output will be mapped.
 * @param f A synchronous or async function to transform the task's result.
 * @returns A new `Task` that produces the transformed value.
 *
 * @example
 * ```typescript
 * const fetchUser = defineTask((id: string) => api.users.get(id));
 * const fetchUserName = map(fetchUser, (user) => user.name);
 * const userName = await run(fetchUserName, 'user-123'); // "John Doe"
 * ```
 */
export function map<C extends { scope: Scope }, V, A, B>(
  task: Task<C, V, A>,
  f: (value: A) => B | Promise<B>
): Task<C, V, B> {
  const mappedTask: Task<C, V, B> = async (context, value) => {
    const result = await task(context, value);
    return f(result);
  };
  Object.defineProperty(mappedTask, 'name', { value: `${task.name || 'task'}.map` });
  return mappedTask;
}

/**
 * Recovers from a failed task by applying a recovery function to the error.
 * This prevents the entire workflow from halting on a specific error.
 * Does not catch `BacktrackSignal`.
 *
 * @param task The task that might fail.
 * @param f A function that takes the error and returns a fallback value.
 * @returns A new `Task` that will succeed with either the original
 *          result or the result of the recovery function.
 *
 * @example
 * ```typescript
 * const fetchConfig = defineTask(() => api.getConfig());
 * const withDefault = recover(fetchConfig, (err) => {
 *   console.warn("Couldn't fetch config, using default", err);
 *   return { theme: 'dark' };
 * });
 * ```
 */
export function recover<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  f: (error: unknown) => R | Promise<R>
): Task<C, V, R> {
  const recoveryTask: Task<C, V, R> = async (context, value) => {
    try {
      return await task(context, value);
    } catch (error) {
      if (isBacktrackSignal(error)) throw error;
      return f(error);
    }
  };
  Object.defineProperty(recoveryTask, 'name', { value: `${task.name || 'task'}.recover` });
  return recoveryTask;
}

/**
 * Recovers from a failed task by executing a new "recovery" task.
 * Useful for chaining a new asynchronous operation upon failure, like
 * trying a backup data source. Does not catch `BacktrackSignal`.
 *
 * @param task The task that might fail.
 * @param f A function that takes the error and returns a new `Task` to execute.
 * @returns A new `Task` that combines the original and recovery paths.
 *
 * @example
 * ```typescript
 * const fetchPrimary = defineTask(() => api.primary.getData());
 * const fetchBackup = defineTask(() => api.backup.getData());
 *
 * const resilientFetch = recoverWith(fetchPrimary, () => fetchBackup);
 * ```
 */
export function recoverWith<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  f: (error: unknown) => Task<C, unknown, R>
): Task<C, V, R> {
  const recoveryTask: Task<C, V, R> = async (context, value) => {
    try {
      return await task(context, value);
    } catch (error) {
      if (isBacktrackSignal(error)) throw error;
      const fallbackTask = f(error);
      return fallbackTask(context, error);
    }
  };
  Object.defineProperty(recoveryTask, 'name', { value: `${task.name || 'task'}.recoverWith` });
  return recoveryTask;
}

// --- Task Decorators ---

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoff?: 'fixed' | 'exponential';
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Wraps a task with automatic retry logic. The delay between retries
 * is cancellable and respects the parent scope's `AbortSignal`.
 *
 * @param task The task to make resilient.
 * @param options Configuration for the retry behavior.
 * @returns A new task that will retry on failure.
 *
 * @example
 * ```typescript
 * const unstableFetch = defineTask(async () => {
 *   if (Math.random() > 0.5) throw new Error('Network error');
 *   return { data: 'success' };
 * });
 *
 * const resilientFetch = withRetry(unstableFetch, { attempts: 5, delayMs: 200 });
 * const result = await run(resilientFetch, null);
 * ```
 */
export function withRetry<C extends { scope: Scope; logger?: Logger }, V, R>(
  task: Task<C, V, R>,
  options: RetryOptions = {}
): Task<C, V, R> {
  const {
    attempts = 3,
    delayMs = 100,
    backoff = 'exponential',
    shouldRetry = () => true,
  } = options;

  return defineTask(async (value: V) => {
    const context = getContext<C>();
    const logger = context.logger || noopLogger;
    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
      try {
        if (context.scope.signal.aborted) throw context.scope.signal.reason;
        return await task(context, value);
      } catch (error) {
        lastError = error;
        if (isBacktrackSignal(error) || !shouldRetry(error)) throw error;

        if (i < attempts - 1) {
          const currentDelay = backoff === 'exponential' ? delayMs * 2 ** i : delayMs;
          logger.warn(`Task '${task.name}' failed. Retrying in ${currentDelay}ms... (Attempt ${i + 1}/${attempts})`, error);

          // Create a cancellable delay
          const delayPromise = new Promise(resolve => setTimeout(resolve, currentDelay));
          const abortPromise = new Promise((_, reject) => {
            context.scope.signal.addEventListener('abort', () => reject(context.scope.signal.reason), { once: true });
          });
          await Promise.race([delayPromise, abortPromise]);
        }
      }
    }
    throw lastError;
  });
}

/**
 * Wraps a task with a timeout. If the task does not complete within the
 * specified duration, it will throw a `TimeoutError`. This race is safe
 * and respects parent cancellation.
 *
 * @param task The task to apply the timeout to.
 * @param durationMs The timeout duration in milliseconds.
 * @returns A new task that will fail if it runs too long.
 *
 * @example
 * ```typescript
 * const slowTask = defineTask(async () => new Promise(r => setTimeout(r, 5000)));
 * const fastTask = withTimeout(slowTask, 1000);
 * // This will throw a TimeoutError
 * await run(fastTask, null);
 * ```
 */
export function withTimeout<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  durationMs: number
): Task<C, V, R> {
  class TimeoutError extends Error {
    constructor() {
      super(`Task '${task.name || 'anonymous'}' timed out after ${durationMs}ms.`);
      this.name = 'TimeoutError';
    }
  }

  return defineTask(async (value: V) => {
    const context = getContext<C>();

    const timeoutPromise = new Promise<never>((_, reject) => {
      const timerId = setTimeout(() => reject(new TimeoutError()), durationMs);
      // Clean up the timer if the task finishes or the scope aborts first.
      context.scope.signal.addEventListener('abort', () => clearTimeout(timerId), { once: true });
    });

    return Promise.race([task(context, value), timeoutPromise]);
  });
}

/**
 * Attaches a descriptive name to a task for better logging and debugging.
 *
 * @param task The task to name.
 * @param name The new name for the task.
 * @returns A new task instance with the specified name.
 */
export function withName<C extends { scope: Scope }, V, R>(task: Task<C, V, R>, name: string): Task<C, V, R> {
  const namedTask: Task<C, V, R> = (ctx, val) => task(ctx, val);
  Object.defineProperty(namedTask, 'name', { value: name, configurable: true });
  if (task.__task_id) namedTask.__task_id = task.__task_id;
  if (task.__steps) namedTask.__steps = task.__steps;
  return namedTask;
}

export interface RateLimitOptions {
  limit: number;
  intervalMs: number;
}

/**
 * Wraps a task with client-side rate limiting using a token bucket algorithm.
 * This ensures the task is not executed more than a specified number of times
 * within a given interval. The rate limit state is shared across all calls
 * to the wrapped task within the same process.
 *
 * @param task The task to rate-limit.
 * @param options The rate-limiting configuration.
 * @returns A new, rate-limited task.
 */
export function withRateLimit<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  options: RateLimitOptions
): Task<C, V, R> {
  const { limit, intervalMs } = options;
  const callQueue: { value: V; resolve: (v: R) => void; reject: (r: any) => void }[] = [];
  let tokens = limit;
  let isProcessing = false;

  const refillTokens = () => {
    tokens = Math.min(limit, tokens + 1);
  };
  setInterval(refillTokens, intervalMs / limit);

  const processQueue = async () => {
    if (isProcessing || callQueue.length === 0) return;
    isProcessing = true;

    while (callQueue.length > 0) {
      if (tokens < 1) {
        // Wait for the next token to be available
        await new Promise(r => setTimeout(r, intervalMs / limit));
        continue;
      }

      tokens--;
      const { resolve, reject, value } = callQueue.shift()!;
      task(getContext<C>(), value).then(resolve).catch(reject);
    }

    isProcessing = false;
  };

  return defineTask((value: V) => {
    return new Promise<R>((resolve, reject) => {
      callQueue.push({ value, resolve, reject });
      processQueue();
    });
  });
}

// --- Task Creators ---

export interface BatchingOptions {
  windowMs?: number;
}

/**
 * Creates a task that batches multiple individual calls into a single,
 * more efficient underlying call, using a pattern similar to Dataloader.
 *
 * @param batchFn A function that accepts an array of keys and returns a promise
 *                resolving to an array of results in the same order.
 * @param options Configuration for the batching window.
 * @returns A new task that takes a single key but executes as part of a batch.
 */
export function createBatchingTask<C extends { scope: Scope }, K, R>(
  batchFn: (keys: K[]) => Promise<R[]>,
  options: BatchingOptions = {}
): Task<C, K, R> {
  let pendingKeys: K[] = [];
  let pendingCallbacks: { resolve: (v: R) => void; reject: (r: any) => void }[] = [];
  let timer: NodeJS.Timeout | null = null;
  const { windowMs = 10 } = options;

  const dispatch = () => {
    if (timer) clearTimeout(timer);
    timer = null;

    const keys = pendingKeys;
    const callbacks = pendingCallbacks;
    pendingKeys = [];
    pendingCallbacks = [];

    if (keys.length === 0) return;

    batchFn(keys)
      .then(results => {
        if (results.length !== callbacks.length) {
          throw new Error('Batch function must return an array of the same length as the keys array.');
        }
        callbacks.forEach((cb, i) => cb.resolve(results[i]));
      })
      .catch(error => {
        callbacks.forEach(cb => cb.reject(error));
      });
  };

  return defineTask((key: K) => {
    pendingKeys.push(key);
    const promise = new Promise<R>((resolve, reject) => {
      pendingCallbacks.push({ resolve, reject });
    });

    if (!timer) {
      timer = setTimeout(dispatch, windowMs);
    }

    return promise;
  });
}

// --- Context and Testing Utilities ---

/**
 * Runs a function with a temporarily overridden context. Ideal for dependency
 * injection in tests, allowing you to mock services for a specific operation.
 *
 * @param overrides An object with properties to override in the current context.
 * @param fn The function to execute within the temporary context. It must be
 *           a function that returns a Promise (e.g., an async function).
 * @returns The return value of the provided function.
 */
export async function provide<C extends { scope: Scope }, R>(
  overrides: Partial<Omit<C, 'scope'>>,
  fn: () => Promise<R>
): Promise<R> {
  const parentContext = getContextOrUndefined<C>();
  if (!parentContext) {
    throw new Error('provide() must be called within an existing `run` execution.');
  }

  // To do this correctly, we need access to the `unctx.callAsync` function.
  // This implies `provide` should be created by and returned from `createContext`.
  // If it must be a standalone utility, it has to create a new, limited sub-context.
  const { run } = createContext<C>({} as any); // A simplified context for the sub-run
  return run(defineTask(fn), null, { overrides });
}

// --- Result-based Composition ---

/**
 * Transforms the `Ok` value of a `Result`-returning task. If the task
 * returns an `Err`, it is passed through unmodified.
 *
 * @param task The task returning a `Result`.
 * @param f A mapping function for the `Ok` value.
 * @returns A new task that performs the mapping on the `Result`.
 */
export function mapOk<C extends { scope: Scope }, V, T, E, R>(
  task: Task<C, V, Result<T, E>>,
  f: (value: T) => R
): Task<C, V, Result<R, E>> {
  return map(task, (result) => result.map(f));
}

/**
 * Chains a new `Result`-returning task to a previous one. If the first task
 * returns an `Err`, the second task is skipped, and the error is propagated.
 *
 * @param task The initial `Result`-returning task.
 * @param f A function that takes an `Ok` value and returns a new `Result`-returning task.
 * @returns A new task representing the chained `Result` operation.
 */
export function andThenResult<C extends { scope: Scope }, V, T1, E1, T2, E2>(
  task: Task<C, V, Result<T1, E1>>,
  f: (value: T1) => Task<C, T1, Result<T2, E2>>
): Task<C, V, Result<T2, E1 | E2>> {
  return defineTask(async (value: V) => {
    const context = getContext<C>();
    const result1 = await task(context, value);
    return result1.isErr() ? err(result1.error) : f(result1.value)(context, result1.value);
  });
}

/**
 * Recovers from an `Err` in a `Result`-returning task by applying a function
 * to the error value. This allows you to handle specific errors gracefully.
 *
 * @param task The `Result`-returning task that might fail.
 * @param f A function that takes the `Err` value and returns a new `Result`.
 * @returns A new task with the error-handling logic.
 */
export function recoverResult<C extends { scope: Scope }, V, T, E1, E2>(
  task: Task<C, V, Result<T, E1>>,
  f: (error: E1) => Result<T, E2>
): Task<C, V, Result<T, E2>> {
  return map(task, (result) => result.orElse(f));
}


// A lightweight deep-equal implementation for memoize key comparison
// This is a simplified version; for production, a library like 'fast-deep-equal' might be better.
const deepEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if (a.constructor !== b.constructor) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(b, key) || !deepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return a !== a && b !== b; // NaN case
};

// --- 1. Chain Starters ---

/**
 * Starts a workflow with a static, known value.
 *
 * @param value The static value to begin the workflow with.
 * @returns A `Task` that resolves to the provided value.
 */
export function fromValue<T>(value: T): Task<any, null, T> {
  return defineTask(() => Promise.resolve(value));
}

/**
 * Starts a workflow by awaiting a `Promise`. The resolved value of the promise
 * becomes the initial value for the next task in the pipeline.
 *
 * @param promise The promise to await.
 * @returns A `Task` that resolves to the promise's value.
 */
export function fromPromise<T>(promise: Promise<T>): Task<any, null, T> {
  return defineTask(() => promise);
}

/**
 * Starts a workflow by executing an async function that returns a `Promise`.
 * This is useful when the initial async operation needs access to the context.
 *
 * @param fn An async function that receives the context and returns a promise.
 * @returns A `Task` that resolves to the value from the async function.
 */
export function fromPromiseFn<C extends { scope: Scope }, T>(
  fn: (context: C) => Promise<T>
): Task<C, null, T> {
  return defineTask(() => fn(getContext<C>()));
}


// --- 2. Flow Control & Logic ---

/**
 * Executes the provided task only if the predicate function returns `true`.
 * If it returns `false`, the original value is passed through unchanged.
 *
 * @param predicate A function that returns `true` to execute the task.
 * @param task The `Task` to execute conditionally. It must accept and return the same type.
 * @returns A `Task` that conditionally executes the given task.
 */
export function when<C extends { scope: Scope }, V>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  task: Task<C, V, V>
): Task<C, V, V> {
  return defineTask(async (value: V) => {
    const context = getContext<C>();
    if (await predicate(value, context)) {
      return task(context, value);
    }
    return value;
  });
}

/**
 * Executes the task only if the predicate function returns `false`.
 * This is the inverse of `when`.
 *
 * @param predicate A function that returns `false` to execute the task.
 * @param task The `Task` to execute conditionally.
 * @returns A `Task` that conditionally executes the given task.
 */
export function unless<C extends { scope: Scope }, V>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  task: Task<C, V, V>
): Task<C, V, V> {
  return defineTask(async (value: V) => {
    const context = getContext<C>();
    if (!(await predicate(value, context))) {
      return task(context, value);
    }
    return value;
  });
}

/**
 * Executes a task repeatedly as long as the predicate returns `true` for the task's output.
 *
 * @param task The `Task` to execute in a loop.
 * @param predicate The condition to continue the loop.
 * @returns A `Task` that represents the complete loop.
 */
export function doWhile<C extends { scope: Scope }, V>(
  task: Task<C, V, V>,
  predicate: (value: V, context: C) => boolean | Promise<boolean>
): Task<C, V, V> {
  return defineTask(async (initialValue: V) => {
    const context = getContext<C>();
    let currentValue = initialValue;

    while (await predicate(currentValue, context)) {
      if (context.scope.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      currentValue = await task(context, currentValue);
    }

    return currentValue;
  });
}



/**
 * Transforms the value in a workflow into a new `Task` or workflow.
 * This is the most powerful composition helper, also known as `chain` or `bind`.
 *
 * @param f A function that takes a value and returns a new `Task`.
 * @returns A `Task` that represents the branched workflow.
 */
export function flatMap<C extends { scope: Scope }, V, R>(
  f: (value: V, context: C) => Task<C, V, R>
): Task<C, V, R> {
  return defineTask((value: V) => {
    const context = getContext<C>();
    const nextTask = f(value, context);
    return nextTask(context, value);
  });
}

/**
 * Creates a new object from the input object, containing only the specified keys.
 *
 * @param keys The keys to pick from the object.
 * @returns A `Task` that resolves to the new, smaller object.
 */
export function pick<T extends object, K extends keyof T>(...keys: K[]): Task<any, T, Pick<T, K>> {
  return defineTask((value: T) => {
    const newObj = {} as Pick<T, K>;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        newObj[key] = value[key];
      }
    }
    return Promise.resolve(newObj);
  });
}


// --- 4. Error & Side Effect Handling ---

/**
 * Performs a side effect (like logging) with the current value but
 * does not change the value flowing through the chain.
 *
 * @param f A function to execute as a side effect.
 * @returns A `Task` that passes the original value through after the side effect.
 */
export function tap<C extends { scope: Scope }, V>(
  f: (value: V, context: C) => void | Promise<void>
): Task<C, V, V> {
  return defineTask(async (value: V) => {
    await f(value, getContext<C>());
    return value;
  });
}

/**
 * Performs a side effect if a task fails. This does not catch the error;
 * it only allows you to observe it before it continues to propagate.
 *
 * @param task The task to watch for errors.
 * @param f The side-effect function to run on error.
 * @returns A new `Task` with the error tapping behavior.
 */
export function tapError<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  f: (error: unknown, context: C) => void | Promise<void>
): Task<C, V, R> {
  return defineTask(async (value: V) => {
    const context = getContext<C>();
    try {
      return await task(context, value);
    } catch (error) {
      if (!isBacktrackSignal(error)) {
        await f(error, context);
      }
      throw error;
    }
  });
}

/**
 * Wraps a `Task` that might throw an exception and converts its outcome into a `Result`
 * object: `{ ok: true, value: T }` or `{ ok: false, error: E }`. This prevents a
 * workflow from halting on a thrown error.
 *
 * @param task The `Task` to wrap.
 * @returns A `Task` that always succeeds with a `Result` object.
 */
export function attempt<C extends { scope: Scope }, V, R, E extends Error>(
  task: Task<C, V, R>
): Task<C, V, { ok: true, value: R } | { ok: false, error: E }> {
  return defineTask(async (value: V) => {
    try {
      const resultValue = await task(getContext<C>(), value);
      return { ok: true, value: resultValue };
    } catch (error) {
      if (isBacktrackSignal(error)) throw error;
      return { ok: false, error: error as E };
    }
  });
}


// --- 5. Task & Resource Management ---

/**
 * Creates a memoized version of a `Task`. The result is cached based on the
 * input value (compared by deep equality). Subsequent calls with the same
 * input will return the cached result instead of re-executing.
 *
 * @param task The `Task` to memoize.
 * @returns A new memoized `Task`.
 */
export function memoize<C extends { scope: Scope }, V, R>(task: Task<C, V, R>): Task<C, V, R> {
  const cache = new Map<V, Promise<R>>();
  const findInCache = (key: V) => {
    for (const [k, v] of cache.entries()) {
      if (deepEqual(k, key)) return v;
    }
    return undefined;
  };
  return defineTask((value: V) => {
    const cachedPromise = findInCache(value);
    if (cachedPromise) {
      return cachedPromise;
    }
    const newPromise = task(getContext<C>(), value);
    cache.set(value, newPromise);
    return newPromise;
  });
}

/**
 * Creates a new version of a `Task` that is guaranteed to execute only once.
 * All subsequent calls will receive the same, cached result from the first
 * execution, regardless of the input value. Ideal for initializing singletons.
 *
 * @param task The `Task` to execute once.
 * @returns A new `Task` that runs only once.
 */
export function once<C extends { scope: Scope }, V, R>(task: Task<C, V, R>): Task<C, V, R> {
  let promise: Promise<R> | null = null;
  return defineTask((value: V) => {
    if (promise) {
      return promise;
    }
    promise = task(getContext<C>(), value);
    return promise;
  });
}

/**
 * A simple `Task` that pauses the workflow for a specified number of milliseconds.
 * The delay is cancellable via the context's `AbortSignal`.
 *
 * @param ms The number of milliseconds to sleep.
 * @returns A `Task` that introduces a delay.
 */
export function sleep(ms: number): Task<any, any, void> {
  return defineTask(() => {
    const context = getContext();
    if (context.scope.signal.aborted) {
      return Promise.reject(new DOMException('Aborted', 'AbortError'));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      context.scope.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  });
}

// --- State Management ---

/**
 * Tools provided to a stateful workflow for interacting with its local state.
 */
export interface StateTools<S> {
  /**
   * Retrieves the current state.
   * @returns The current state object.
   */
  getState: () => S;

  /**
   * Updates the state by providing a new state object or a function that
   * receives the previous state and returns the new state.
   * @param updater A new state object or a function to produce the new state.
   */
  setState: (updater: S | ((prevState: S) => S)) => void;
}

/**
 * Creates a task that encapsulates a stateful workflow. The state is private
 * to this workflow and does not pollute the main context. The final state is
 * returned along with the workflow's result.
 *
 * This is powerful for building complex, multi-step operations that need to
 * accumulate data or manage a state machine without passing state through
 * every single task's input/output.
 *
 * @template C The main context type.
 * @template V The input type for the entire stateful workflow.
 * @template R The final result type of the inner workflow.
 * @template S The type of the local state.
 * @param initialState A function that receives the initial input `V` and produces the initial state `S`.
 * @param workflowFn A function that receives the state management `tools` and returns the `Task` to execute.
 * @returns A new `Task` that, when run, executes the inner workflow and resolves
 *          to an object containing the final `result` and `state`.
 *
 * @example
 * ```typescript
 * // A workflow that processes pages of data, tracking progress in a local state.
 * interface Page { items: string[]; nextPageToken?: string; }
 * interface ProgressState { itemsProcessed: number; allItems: string[]; }
 *
 * const processPage = defineTask(async (page: Page) => {
 *   const { setState } = useStateContext<ProgressState>();
 *   // ... process page.items
 *   setState(prev => ({
 *     itemsProcessed: prev.itemsProcessed + page.items.length,
 *     allItems: [...prev.allItems, ...page.items],
 *   }));
 *   return api.fetchNextPage(page.nextPageToken); // returns a new Page
 * });
 *
 * const processAllPages = withState(
 *   () => ({ itemsProcessed: 0, allItems: [] }), // Initial state
 *   () => doWhile(processPage, (page) => !!page.nextPageToken) // Inner workflow
 * );
 *
 * // The final run returns both the last page and the accumulated state.
 * const { result, state } = await run(processAllPages, { items: [], nextPageToken: 'start' });
 * console.log(`Processed ${state.itemsProcessed} items in total.`);
 * ```
 */
export function withState<C extends { scope: Scope }, V, R, S>(
  initialState: (initialValue: V) => S,
  workflowFn: (tools: StateTools<S>) => Task<C, V, R>
): Task<C, V, { result: R; state: S }> {
  return defineTask(async (initialValue: V) => {
    const context = getContext<C>();
    let state: S = initialState(initialValue);

    const tools: StateTools<S> = {
      getState: () => state,
      setState: (updater) => {
        state = typeof updater === 'function'
          ? (updater as (prevState: S) => S)(state)
          : updater;
      },
    };

    const innerWorkflow = workflowFn(tools);
    const result = await innerWorkflow(context, initialValue);

    return { result, state };
  });
}

// --- Observability ---

/**
 * Wraps a task with an observability "span". A span logs the start and end of a
 * task's execution, including its duration and outcome (success or failure).
 * This requires a `logger` to be present in the task's context.
 *
 * This is invaluable for debugging, performance monitoring, and understanding
 * the flow of complex workflows.
 *
 * @template C The context type, which must include a `Logger`.
 * @template V The input type of the task.
 * @template R The result type of the task.
 * @param task The `Task` to wrap with a span.
 * @param spanName An optional, explicit name for the span. If not provided,
 *                 the name of the wrapped task will be used.
 * @returns A new `Task` that includes the observability logging.
 *
 * @example
 * ```typescript
 * const fetchUserData = defineTask(async (id: string) => api.users.get(id));
 *
 * // Wrap the task to add logging for its execution.
 * const observedFetch = withSpan(fetchUserData, 'Fetch-User-From-API');
 *
 * // When run, this will produce logs like:
 * // [Span Start] Fetch-User-From-API
 * // [Span End] Fetch-User-From-API - Success (123.45ms)
 * await run(observedFetch, 'user-123', { logger: console });
 *
 * // Example with an error:
 * // [Span Start] Fetch-User-From-API
 * // [Span End] Fetch-User-From-API - Failure (50.10ms)
 * // ... followed by the thrown error.
 * ```
 */
export function withSpan<C extends { scope: Scope; logger?: Logger }, V, R>(
  task: Task<C, V, R>,
  spanName?: string
): Task<C, V, R> {
  return defineTask(async (value: V) => {
    const context = getContext<C>();
    const logger = context.logger || noopLogger;
    const name = spanName || task.name || 'anonymous_task';

    logger.debug(`[Span Start] ${name}`);
    const startTime = performance.now();

    try {
      const result = await task(context, value);
      const duration = performance.now() - startTime;
      logger.info(`[Span End] ${name} - Success (${duration.toFixed(2)}ms)`);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      // Log the failure but do not swallow the error.
      // It must be re-thrown to allow for proper error handling by the workflow.
      logger.error(`[Span End] ${name} - Failure (${duration.toFixed(2)}ms)`, { error });
      throw error;
    }
  });
}


/**
 * Options for the `throttle` utility.
 */
export interface ThrottleOptions {
  /** The maximum number of times the task can be executed per interval. */
  limit: number;
  /** The time interval in milliseconds. */
  intervalMs: number;
}

/**
 * Creates a throttled version of a task that will not execute more than a
 * specified number of times within a given interval. Calls that exceed the
 * limit are queued and executed as capacity becomes available.
 *
 * This is essential for interacting with services that have strict rate limits.
 * It uses a token bucket-style algorithm to manage the call rate smoothly.
 *
 * @param task The `Task` to throttle.
 * @param options The throttling configuration.
 * @returns A new, throttled `Task`.
 *
 * @example
 * ```typescript
 * const apiCall = defineTask((id: number) => api.getData(id));
 *
 * // Ensure this task is called at most 10 times per second.
 * const throttledApiCall = throttle(apiCall, { limit: 10, intervalMs: 1000 });
 *
 * // Run many calls in parallel; they will be queued and executed respecting the rate limit.
 * await run(parallelAll(
 *   Array.from({ length: 50 }, (_, i) => () => throttledApiCall(i))
 * ));
 * ```
 */
export function throttle<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  options: ThrottleOptions
): Task<C, V, R> {
  const { limit, intervalMs } = options;
  const callQueue: { value: V; resolve: (v: R) => void; reject: (r: any) => void; context: C }[] = [];
  let currentTokens = limit;
  let isProcessing = false;

  // Refill tokens over time.
  const refillInterval = setInterval(() => {
    currentTokens = Math.min(limit, currentTokens + 1);
    processQueue();
  }, intervalMs / limit);

  // Stop refilling if the process exits (in Node.js environments).
  if (typeof refillInterval.unref === 'function') {
    refillInterval.unref();
  }

  const processQueue = async () => {
    if (isProcessing || callQueue.length === 0) return;
    isProcessing = true;

    while (callQueue.length > 0 && currentTokens >= 1) {
      if (callQueue[0].context.scope.signal.aborted) {
        const { reject, context } = callQueue.shift()!;
        reject(context.scope.signal.reason);
        continue;
      }

      currentTokens--;
      const { resolve, reject, value, context } = callQueue.shift()!;
      task(context, value).then(resolve).catch(reject);
    }
    isProcessing = false;
  };

  return defineTask((value: V) => {
    return new Promise<R>((resolve, reject) => {
      const context = getContext<C>();
      callQueue.push({ value, resolve, reject, context });
      processQueue();
    });
  });
}

/**
 * Options for the `poll` utility.
 */
export interface PollOptions<R> {
  /** The interval in milliseconds between polling attempts. */
  intervalMs: number;
  /** The maximum total time in milliseconds to poll before timing out. */
  timeoutMs: number;
  /** A predicate function that receives the task's result. Polling stops when it returns `true`. */
  until: (result: R) => boolean;
}

/**
 * A custom error thrown by `poll` when the timeout is reached before the
 * `until` condition is met.
 */
export class PollTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Polling timed out after ${timeoutMs}ms.`);
    this.name = 'PollTimeoutError';
    Object.setPrototypeOf(this, PollTimeoutError.prototype);
  }
}

/**
 * Creates a task that repeatedly executes another task on a given interval
 * until a condition is met or a timeout is reached. This is perfect for
 * checking the status of a long-running background job.
 *
 * @param task The `Task` to execute repeatedly.
 * @param options Configuration for the polling behavior.
 * @returns A new `Task` that represents the entire polling operation. It
 *          resolves with the first result that satisfies the `until` condition.
 *
 * @example
 * ```typescript
 * interface JobStatus { status: 'PENDING' | 'COMPLETE' | 'FAILED'; data?: any; }
 * const checkJob = defineTask((jobId: string) => api.jobs.getStatus(jobId));
 *
 * // Poll the job status every 5 seconds for up to 2 minutes.
 * const waitForJobCompletion = poll(checkJob, {
 *   intervalMs: 5000,
 *   timeoutMs: 120000,
 *   until: (job) => job.status === 'COMPLETE',
 * });
 *
 * // This will run until the job is complete or it times out.
 * const completedJob = await run(waitForJobCompletion, 'job-123');
 * ```
 */
export function poll<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  options: PollOptions<R>
): Task<C, V, R> {
  const { intervalMs, timeoutMs, until } = options;

  return defineTask(async (value: V) => {
    const context = getContext<C>();
    const startTime = Date.now();

    // Create a cancellable delay promise
    const sleep = (ms: number) => new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      context.scope.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(context.scope.signal.reason);
      }, { once: true });
    });

    while (true) {
      if (Date.now() - startTime > timeoutMs) {
        throw new PollTimeoutError(timeoutMs);
      }

      const result = await task(context, value);
      if (until(result)) {
        return result;
      }

      await sleep(intervalMs);
    }
  });
}

// --- Structured Dependency Injection ---

type ServiceConstructor<T, C> = (context: C) => T;
type ContextBuilderInput<C> = {
  [K in keyof C]: C[K] | ServiceConstructor<C[K], Partial<C>>;
};

/**
 * An error thrown by `buildContext` if dependencies cannot be resolved.
 */
export class DiResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DiResolutionError';
    Object.setPrototypeOf(this, DiResolutionError.prototype);
  }
}

/**
 * Builds a complete context object from a set of service constructors and
 * primitive values. It automatically resolves the dependency graph, ensuring
 * that services are created in the correct order.
 *
 * This utility provides an optional, more structured approach to dependency
 * injection for large applications, preventing common issues like circular
 * dependencies and incorrect initialization order.
 *
 * @param builderInput An object where keys are service names and values are
 *                     either primitive values (like config objects) or
 *                     "service constructors" (functions that take dependencies
 *                     and return a service instance).
 * @returns A fully resolved context object with all services initialized.
 * @throws {DiResolutionError} if a circular dependency is detected.
 *
 * @example
 * ```typescript
 * // Define service constructors that declare their dependencies.
 * const createDb = (deps: { config: AppConfig }) => new DbClient(deps.config.dbUrl);
 * const createApi = (deps: { config: AppConfig }) => new ApiClient(deps.config.apiUrl);
 * const createAuthService = (deps: { db: DbClient }) => new AuthService(deps.db);
 *
 * // buildContext resolves the graph and creates the final context.
 * const context = buildContext({
 *   config: myAppConfig, // A primitive value
 *   db: createDb,
 *   api: createApi,
 *   auth: createAuthService, // Depends on `db`
 * });
 *
 * // `context` is now a fully typed object: { config, db, api, auth }
 * ```
 */
export function buildContext<C extends object>(builderInput: ContextBuilderInput<C>): C {
  const context: Partial<C> = {};
  const constructors: Map<keyof C, Function> = new Map();
  const dependencyGraph: Map<keyof C, (keyof C)[]> = new Map();

  // 1. Separate primitives from constructors and build the initial graph.
  for (const key in builderInput) {
    const value = builderInput[key as keyof C];
    if (typeof value === 'function') {
      constructors.set(key as keyof C, value);
      // Use a proxy to track dependency access during a dry run.
      const accessedDeps = new Set<keyof C>();
      const proxy = new Proxy({}, {
        get(_, prop) {
          accessedDeps.add(prop as keyof C);
          // Return a dummy value so the constructor doesn't fail.
          return new Proxy(() => { }, { get: () => proxy, apply: () => proxy });
        },
      });
      try {
        (value as Function)(proxy);
        dependencyGraph.set(key as keyof C, Array.from(accessedDeps));
      } catch (e) {
        // Ignore errors from the dry run, as not all dependencies are real.
      }
    } else {
      context[key as keyof C] = value as C[keyof C];
    }
  }

  // 2. Perform a topological sort to find the correct initialization order.
  const sorted: (keyof C)[] = [];
  const visited: Set<keyof C> = new Set(); // For permanent marking
  const visiting: Set<keyof C> = new Set(); // For detecting cycles

  const visit = (node: keyof C) => {
    if (visited.has(node)) return;
    if (visiting.has(node)) {
      throw new DiResolutionError(`Circular dependency detected involving "${String(node)}"`);
    }

    visiting.add(node);
    const deps = dependencyGraph.get(node) || [];
    for (const dep of deps) {
      // Only visit nodes that are constructors themselves.
      if (constructors.has(dep)) {
        visit(dep);
      }
    }
    visiting.delete(node);
    visited.add(node);
    sorted.push(node);
  };

  for (const key of constructors.keys()) {
    if (!visited.has(key)) {
      visit(key);
    }
  }

  // 3. Construct the services in the sorted order.
  for (const key of sorted) {
    const constructor = constructors.get(key)!;
    context[key] = constructor(context);
  }

  return context as C;
}