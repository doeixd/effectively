import type { Task, Scope } from './run';
import { defineTask, getContext } from './run';

/**
 * Defines the priority levels for task scheduling, influencing the order and
 * timing of execution. This type maps to the browser's `TaskPriority` enum
 * when the native Scheduler API is available.
 */
export type TaskPriority = 'user-blocking' | 'user-visible' | 'background';

/**
 * Provides a set of options to control the execution behavior of parallel operations.
 */
export interface ParallelOptions {
  /**
   * The maximum number of tasks that are allowed to run concurrently.
   * @default Infinity
   */
  concurrency?: number;

  /**
   * The priority for the scheduled tasks. This is a hint to the scheduler
   * about the importance of the tasks.
   * @default 'user-visible'
   */
  priority?: TaskPriority;

  /**
   * If true, tasks are grouped into batches and scheduled together. This can
   * improve performance by reducing scheduling overhead, but may alter execution timing.
   * When enabled, the `concurrency` option is not applied.
   * @default false
   */
  batching?: boolean;

  /**
   * The number of tasks to include in each batch when `batching` is enabled.
   * @default 10
   */
  batchSize?: number;

  /**
   * If true, the results array will have the same order as the input tasks array.
   * If false, results are returned in the order they complete, which can offer a
   * minor performance improvement. This option does not apply to iterator-based
   * functions like `parallelFrom`, which always stream results as they complete.
   * @default true
   */
  preserveOrder?: boolean;

  /**
   * An `AbortSignal` that can be used to cancel the entire parallel operation.
   * If not provided, the signal from the current context's scope is used.
   */
  signal?: AbortSignal;
}

/**
 * Represents the result of a single task executed within a parallel operation.
 * It's a discriminated union that indicates whether the task succeeded or failed.
 */
export type ParallelResult<T> =
  | { status: 'fulfilled'; value: T; index: number }
  | { status: 'rejected'; reason: unknown; index: number };

/**
 * Defines the contract for a task scheduler, abstracting the underlying
 * mechanism for scheduling asynchronous work (e.g., native `scheduler.postTask`
 * or a Promise-based fallback).
 */
export interface Scheduler {
  /**
   * Schedules a callback function to be executed asynchronously.
   * @param callback The function to execute.
   * @param options Scheduling options like priority and signal.
   * @returns A promise that resolves with the callback's return value.
   */
  postTask<T>(
    callback: () => T | Promise<T>,
    options?: { priority?: TaskPriority; signal?: AbortSignal }
  ): Promise<T>;

  /**
   * A boolean indicating if the scheduler is using the native browser API.
   */
  readonly isNative: boolean;
}

// Internal implementation details (classes, etc.) are not documented for the public API.
class NativeScheduler implements Scheduler {
  readonly isNative = true;
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T> {
    if ('scheduler' in globalThis && 'postTask' in (globalThis as any).scheduler) {
      return (globalThis as any).scheduler.postTask(callback, options);
    }
    const delay = this.getPriorityDelay(options?.priority);
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        try { resolve(await callback()); } catch (error) { reject(error); }
      }, delay);
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  }
  private getPriorityDelay = (p?: TaskPriority) => p === 'user-blocking' ? 0 : p === 'background' ? 250 : 0;
}

class PromiseScheduler implements Scheduler {
  readonly isNative = false;
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options?.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const schedule = options?.priority === 'user-blocking' ? queueMicrotask : (cb: () => void) => setTimeout(cb, 0);
      const abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
      options?.signal?.addEventListener('abort', abortHandler);
      schedule(async () => {
        if (options?.signal?.aborted) {
          options.signal.removeEventListener('abort', abortHandler);
          return;
        }
        try { resolve(await callback()); } catch (error) { reject(error); }
        finally { options?.signal?.removeEventListener('abort', abortHandler); }
      });
    });
  }
}

/**
 * Returns the best available scheduler for the current environment.
 * It prefers the native browser scheduler and falls back to a promise-based one.
 * @returns An instance of a `Scheduler`.
 */
export function getScheduler(): Scheduler {
  if ('scheduler' in globalThis && 'postTask' in (globalThis as any).scheduler) {
    return new NativeScheduler();
  }
  return new PromiseScheduler();
}

/**
 * A shared, default instance of the scheduler.
 */
export const scheduler = getScheduler();

/**
 * Executes an array of tasks in parallel with fine-grained control over
 * concurrency, priority, and cancellation.
 *
 * @template C The context type required by the tasks.
 * @template V The type of the input value passed to each task.
 * @template R The type of the result produced by each successful task.
 * @param tasks An array of `Task` functions to execute.
 * @param value The input value that will be passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns A promise that resolves to an array of `ParallelResult` objects,
 *          reflecting the outcome of each task.
 *
 * @example
 * ```typescript
 * const [userResult, postsResult] = await parallel(
 *   [fetchUser, fetchPosts],
 *   userId,
 *   { concurrency: 2, priority: 'user-visible' }
 * );
 *
 * if (userResult.status === 'fulfilled') {
 *   console.log('User:', userResult.value);
 * } else {
 *   console.error('Failed to fetch user:', userResult.reason);
 * }
 * ```
 */
export async function parallel<C extends { scope: Scope }, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options: ParallelOptions = {}
): Promise<ParallelResult<R>[]> {
  const context = getContext<C>();
  const finalOptions = {
    concurrency: options.concurrency ?? Infinity,
    priority: options.priority ?? 'user-visible',
    batching: options.batching ?? false,
    batchSize: options.batchSize ?? 10,
    preserveOrder: options.preserveOrder ?? true,
    signal: options.signal ?? context.scope.signal,
  };
  if (tasks.length === 0) return [];
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  finalOptions.signal.addEventListener('abort', onAbort);
  context.scope.signal.addEventListener('abort', onAbort);
  const executionOptions = { ...finalOptions, signal: controller.signal };
  try {
    if (executionOptions.batching) {
      return await executeBatched(tasks, value, context, executionOptions);
    } else if (executionOptions.concurrency === Infinity) {
      return await executeUnlimited(tasks, value, context, executionOptions);
    } else {
      return await executeLimited(tasks, value, context, executionOptions);
    }
  } finally {
    finalOptions.signal.removeEventListener('abort', onAbort);
    context.scope.signal.removeEventListener('abort', onAbort);
  }
}

async function executeUnlimited<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, context: C, options: Required<ParallelOptions>): Promise<ParallelResult<R>[]> {
  const { priority, signal } = options;
  const promises = tasks.map((task, index) => scheduler.postTask(async (): Promise<ParallelResult<R>> => {
    try { return { status: 'fulfilled', value: await task(context, value), index }; }
    catch (reason) { return { status: 'rejected', reason, index }; }
  }, { priority, signal }));
  return Promise.all(promises);
}

async function executeLimited<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, context: C, options: Required<ParallelOptions>): Promise<ParallelResult<R>[]> {
  const { concurrency, priority, signal, preserveOrder } = options;
  const results: ParallelResult<R>[] = preserveOrder ? new Array(tasks.length) : [];
  const executing = new Set<Promise<void>>();
  for (let i = 0; i < tasks.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (executing.size >= concurrency) await Promise.race(executing);
    const index = i;
    const task = tasks[index];
    const promise = scheduler.postTask(async () => {
      try {
        const result = await task(context, value);
        const settledResult: ParallelResult<R> = { status: 'fulfilled', value: result, index };
        preserveOrder ? (results[index] = settledResult) : results.push(settledResult);
      } catch (reason) {
        const settledResult: ParallelResult<R> = { status: 'rejected', reason, index };
        preserveOrder ? (results[index] = settledResult) : results.push(settledResult);
      }
    }, { priority, signal }).finally(() => { executing.delete(promise); });
    executing.add(promise);
  }
  await Promise.all(executing);
  return results;
}

async function executeBatched<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, context: C, options: Required<ParallelOptions>): Promise<ParallelResult<R>[]> {
  const { batchSize, priority, signal } = options;
  const results: ParallelResult<R>[] = [];
  for (let i = 0; i < tasks.length; i += batchSize) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const batch = tasks.slice(i, i + batchSize);
    const batchResults = await scheduler.postTask(() => Promise.all(
      batch.map(async (task, batchIndex): Promise<ParallelResult<R>> => {
        const index = i + batchIndex;
        try { return { status: 'fulfilled', value: await task(context, value), index }; }
        catch (reason) { return { status: 'rejected', reason, index }; }
      })
    ), { priority, signal });
    results.push(...batchResults);
  }
  return results;
}

/**
 * Creates a new `Task` that, when executed, runs an array of tasks in parallel.
 * This is useful for composing complex asynchronous workflows.
 *
 * @param tasks An array of `Task` functions to be executed in parallel.
 * @param options Configuration for controlling the parallel execution.
 * @returns A new `Task` that encapsulates the parallel operation.
 *
 * @example
 * ```typescript
 * // Define a composite task that fetches all data for a page.
 * const fetchPageData = parallelTask(
 *   [fetchHeader, fetchSidebar, fetchContent],
 *   { concurrency: 3 }
 * );
 *
 * // Later, execute it within a scope.
 * const pageDataResults = await run(fetchPageData, { pageId: 123 });
 * ```
 */
export function parallelTask<C extends { scope: Scope }, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  options?: ParallelOptions
): Task<C, V, ParallelResult<R>[]> {
  return defineTask(async (value: V) => parallel(tasks, value, options));
}

/**
 * Executes tasks in parallel and returns an array containing only the values
 * from successfully fulfilled tasks. Failed tasks are ignored.
 *
 * @param tasks An array of `Task` functions to execute.
 * @param value The input value passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns A promise that resolves to an array of successful result values.
 *
 * @example
 * ```typescript
 * // Fetch from multiple sources, but only use the ones that succeed.
 * const availableFeeds = await parallelSettled(
 *   [fetchFeed('a'), fetchFeed('b'), fetchFeed('c')],
 *   apiToken
 * );
 * console.log(`Got ${availableFeeds.length} feeds.`);
 * ```
 */
export async function parallelSettled<C extends { scope: Scope }, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: ParallelOptions
): Promise<R[]> {
  const results = await parallel(tasks, value, { ...options, preserveOrder: false });
  return results
    .filter((r): r is { status: 'fulfilled'; value: R; index: number } => r.status === 'fulfilled')
    .map(r => r.value);
}

/**
 * Executes tasks in parallel and, like `Promise.all`, throws an error if any
 * of the tasks fail. If all tasks succeed, it returns an array of their values.
 *
 * @param tasks An array of `Task` functions to execute.
 * @param value The input value passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns A promise that resolves to an array of all result values if all tasks succeed.
 *          It rejects with the reason of the first task that fails.
 *
 * @example
 * ```typescript
 * try {
 *   // All of these tasks must succeed to build the report.
 *   const [userData, salesData] = await parallelAll(
 *     [fetchCriticalUser, fetchCriticalSales],
 *     authToken
 *   );
 *   generateReport(userData, salesData);
 * } catch (error) {
 *   console.error('Failed to generate report:', error);
 * }
 * ```
 */
export async function parallelAll<C extends { scope: Scope }, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: ParallelOptions
): Promise<R[]> {
  const results = await parallel(tasks, value, { ...options, preserveOrder: true });
  const values: R[] = new Array(results.length);
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    values[result.index] = result.value;
  }
  return values;
}

/**
 * Races multiple tasks and returns the result of the first task to either
 * fulfill or reject, similar to `Promise.race`.
 *
 * @param tasks An array of `Task` functions to race.
 * @param value The input value passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns A promise that resolves or rejects with the value or reason
 *          of the first task to settle.
 *
 * @example
 * ```typescript
 * // Fetch from a primary and a backup endpoint, use whichever is faster.
 * const fastestServerResponse = await race(
 *   [() => fetch('api.primary.com'), () => fetch('api.backup.com')],
 *   requestData
 * );
 * ```
 */
export async function race<C extends { scope: Scope }, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: Omit<ParallelOptions, 'preserveOrder'>
): Promise<R> {
  return raceFrom(tasks, value, options);
}


// --- Iterator-Based Utilities ---

/**
 * Executes tasks from an `Iterable` or `AsyncIterable` in parallel, yielding
 * results as they complete. This is highly memory-efficient for processing a
 * large or dynamically generated set of tasks.
 *
 * @param tasks An `Iterable` or `AsyncIterable` that yields `Task` functions.
 * @param inputValue The input value that will be passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns An async iterable that yields `ParallelResult` objects as they complete.
 *
 * @example
 * ```typescript
 * // A generator for creating many tasks without holding them all in memory.
 * function* makeFetchTasks(urls) {
 *   for (const url of urls) {
 *     yield (ctx, token) => fetch(url, { headers: { Authorization: token } });
 *   }
 * }
 *
 * for await (const result of parallelFrom(makeFetchTasks(urlList), apiToken)) {
 *   if (result.status === 'fulfilled') {
 *     console.log(`URL ${result.index} succeeded.`);
 *   }
 * }
 * ```
 */
export async function* parallelFrom<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): AsyncIterable<ParallelResult<R>> {
  const context = getContext<C>();
  const { concurrency = Infinity, priority = 'user-visible', signal: optionSignal } = options;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  const contextSignal = context.scope.signal;
  optionSignal?.addEventListener('abort', onAbort);
  contextSignal.addEventListener('abort', onAbort);
  const signal = controller.signal;
  const cleanup = () => {
    optionSignal?.removeEventListener('abort', onAbort);
    contextSignal.removeEventListener('abort', onAbort);
  };

  try {
    const executing: Set<Promise<ParallelResult<R>>> = new Set();
    const taskIterator = (tasks as any)[Symbol.asyncIterator] ? (tasks as any)[Symbol.asyncIterator]() : (tasks as any)[Symbol.iterator]();
    let index = 0;
    let iteratorDone = false;

    while (!iteratorDone || executing.size > 0) {
      while (executing.size < concurrency && !iteratorDone) {
        if (signal.aborted) break;
        const iteratorResult = await taskIterator.next();
        if (iteratorResult.done) {
          iteratorDone = true;
          break;
        }
        const task = iteratorResult.value;
        const currentIndex = index++;

        const taskPromise: Promise<ParallelResult<R>> = scheduler.postTask(
          async () => {
            try { return { status: 'fulfilled', value: await task(context, inputValue), index: currentIndex }; }
            catch (reason) { return { status: 'rejected', reason, index: currentIndex }; }
          },
          { priority, signal }
        );

        const resultPromise = taskPromise.then(result => {
          executing.delete(resultPromise);
          return result;
        }, error => {
          executing.delete(resultPromise);
          throw error;
        });
        executing.add(resultPromise);
      }
      if (executing.size === 0) break;
      try {
        yield await Promise.race(executing);
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') break;
        throw error;
      }
    }
  } finally {
    cleanup();
  }
}

/**
 * Executes tasks from an iterator and yields only the values from successfully
 * fulfilled tasks as they complete.
 *
 * @param tasks An `Iterable` or `AsyncIterable` that yields `Task` functions.
 * @param inputValue The input value passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns An async iterable that yields the values of successful tasks.
 *
 * @example
 * ```typescript
 * for await (const pageContent of parallelFromSettled(fetchPageTasks, null)) {
 *   // process pageContent
 * }
 * ```
 */
export async function* parallelFromSettled<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): AsyncIterable<R> {
  for await (const result of parallelFrom(tasks, inputValue, options)) {
    if (result.status === 'fulfilled') yield result.value;
  }
}

/**
 * Executes tasks from an iterator and yields successful values, but throws
 * an error if any task fails.
 *
 * @param tasks An `Iterable` or `AsyncIterable` that yields `Task` functions.
 * @param inputValue The input value passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns An async iterable that yields successful values or throws an error.
 *
 * @example
 * ```typescript
 * try {
 *   for await (const data of parallelFromAll(criticalTasks, null)) {
 *     // process critical data
 *   }
 * } catch (e) {
 *   console.error('A critical task failed!');
 * }
 * ```
 */
export async function* parallelFromAll<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): AsyncIterable<R> {
  for await (const result of parallelFrom(tasks, inputValue, options)) {
    if (result.status === 'fulfilled') {
      yield result.value;
    } else {
      throw result.reason;
    }
  }
}

/**
 * Races tasks from an iterator and returns the result of the first task to settle.
 * It efficiently starts tasks and waits for the first outcome without necessarily
 * iterating through all available tasks.
 *
 * @param tasks An `Iterable` or `AsyncIterable` of tasks to race.
 * @param value The input value passed to each task.
 * @param options Configuration for the race.
 * @returns A promise resolving or rejecting with the first task's outcome.
 *
 * @example
 * ```typescript
 * function* getMirrors() {
 *   yield () => fetch('mirror1.com/data');
 *   yield () => fetch('mirror2.com/data');
 * }
 *
 * const fastestMirror = await raceFrom(getMirrors(), null);
 * ```
 */
export function raceFrom<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  value: V,
  options?: Omit<ParallelOptions, 'preserveOrder' | 'batching'>
): Promise<R> {
  const context = getContext<C>();
  const { priority = 'user-visible', signal = context.scope.signal } = options || {};

  return new Promise(async (resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    const raceController = new AbortController();
    const onAbort = () => raceController.abort();
    signal.addEventListener('abort', onAbort);
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    try {
      let tasksLaunched = 0;
      const promises: Promise<R>[] = [];
      for await (const task of tasks) {
        if (raceController.signal.aborted) break;
        tasksLaunched++;
        promises.push(scheduler.postTask(() => task(context, value), { priority, signal: raceController.signal }));
      }
      if (tasksLaunched === 0) {
        cleanup();
        return reject(new Error('No tasks provided to raceFrom'));
      }
      Promise.race(promises).then(resolve, reject).finally(() => {
        raceController.abort();
        cleanup();
      });
    } catch (error) {
      raceController.abort();
      cleanup();
      reject(error);
    }
  });
}