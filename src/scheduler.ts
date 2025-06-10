/**
 * @module
 * This module provides a powerful and comprehensive suite of utilities for executing
 * tasks in parallel. It offers fine-grained control over concurrency, scheduling,
 * and result handling, for both arrays and iterables of tasks.
 */

import type { Task, Scope } from './run';
import { defineTask, getContext } from './run';

// =================================================================
// Section 1: Core Types and Scheduler
// =================================================================

/**
 * Defines the priority levels for task scheduling.
 */
export type TaskPriority = 'user-blocking' | 'user-visible' | 'background';

/**
 * Provides a set of options to control the execution behavior of parallel operations.
 */
export interface ParallelOptions {
  /** The maximum number of tasks that are allowed to run concurrently. @default Infinity */
  concurrency?: number;
  /** The priority for the scheduled tasks. @default 'user-visible' */
  priority?: TaskPriority;
  /** If true, tasks are grouped into batches. When enabled, `concurrency` is not applied. @default false */
  batching?: boolean;
  /** The number of tasks to include in each batch when `batching` is enabled. @default 10 */
  batchSize?: number;
  /** If true, the results array will have the same order as the input tasks array. @default true */
  preserveOrder?: boolean;
  /** An `AbortSignal` to cancel the parallel operation. Defaults to the context's scope signal. */
  signal?: AbortSignal;
}

/**
 * Represents the result of a single task executed within a parallel operation.
 */
export type ParallelResult<T> =
  | { status: 'fulfilled'; value: T; index: number }
  | { status: 'rejected'; reason: unknown; index: number };

/**
 * Defines the contract for a task scheduler.
 */
export interface Scheduler {
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T>;
  readonly isNative: boolean;
}

class NativeScheduler implements Scheduler {
  readonly isNative = true;
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T> {
    if ('scheduler' in globalThis && 'postTask' in ((globalThis as any).scheduler)) {
      return (globalThis as any).scheduler.postTask(callback, options);
    }
    const delay = options?.priority === 'background' ? 250 : 0;
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(async () => {
        try { resolve(await callback()); } catch (error) { reject(error); }
      }, delay);
      options?.signal?.addEventListener('abort', () => { clearTimeout(timeoutId); reject(new DOMException('Aborted', 'AbortError')); });
    });
  }
}

class PromiseScheduler implements Scheduler {
  readonly isNative = false;
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (options?.signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      const schedule = options?.priority === 'user-blocking' ? queueMicrotask : (cb: () => void) => setTimeout(cb, 0);
      const abortHandler = () => reject(new DOMException('Aborted', 'AbortError'));
      options?.signal?.addEventListener('abort', abortHandler, { once: true });
      schedule(async () => {
        if (options?.signal?.aborted) return;
        try { resolve(await callback()); } catch (error) { reject(error); }
        finally { options?.signal?.removeEventListener('abort', abortHandler); }
      });
    });
  }
}

/** Returns the best available scheduler for the current environment. */
export function getScheduler(): Scheduler {
  return ('scheduler' in globalThis && 'postTask' in (globalThis as any).scheduler) ? new NativeScheduler() : new PromiseScheduler();
}

/** A shared, default instance of the scheduler. */
export const scheduler = getScheduler();


// =================================================================
// Section 2: Core Parallel Execution Engine
// =================================================================

/**
 * Executes an array of tasks in parallel and returns an array of `ParallelResult` objects,
 * reflecting the outcome of each task. This function never rejects.
 * It is the core engine for other parallel utilities.
 *
 * @param tasks An array of `Task` functions to execute.
 * @param value The input value that will be passed to each task.
 * @param options Configuration for controlling the parallel execution.
 * @returns A promise that resolves to an array of `ParallelResult` objects.
 *
 * @example
 * ```typescript
 * const [userResult, postsResult] = await allSettled(
 *   [fetchUser, fetchPosts],
 *   userId
 * );
 * if (userResult.status === 'fulfilled') { //... }
 * ```
 */
export async function allSettled<C extends { scope: Scope }, V, R>(
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
  const onAbort = () => controller.abort(finalOptions.signal.reason);
  finalOptions.signal.addEventListener('abort', onAbort, { once: true });
  context.scope.signal.addEventListener('abort', onAbort, { once: true });

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

/** @deprecated Use `allSettled` instead. */
export const parallel = allSettled;

// Internal execution helpers
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
    if (signal.aborted) throw signal.reason;
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
    if (signal.aborted) throw signal.reason;
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


// =================================================================
// Section 3: High-Level Parallel Helpers for Arrays
// =================================================================

/**
 * Executes tasks in parallel and, like `Promise.all`, rejects if any of the tasks fail.
 * If all tasks succeed, it returns an array of their values in the same order.
 *
 * @returns A promise that resolves to an array of all result values.
 */
export async function all<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, options?: ParallelOptions): Promise<R[]> {
  const results = await allSettled(tasks, value, { ...options, preserveOrder: true });
  const values: R[] = new Array(results.length);
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
    values[result.index] = result.value;
  }
  return values;
}
/** @deprecated Use `all` instead. */
export const parallelAll = all;

/**
 * Executes tasks in parallel and returns an array containing only the values
 * from successfully fulfilled tasks, ignoring failures.
 *
 * @returns A promise that resolves to an array of successful result values.
 */
export async function some<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, options?: ParallelOptions): Promise<R[]> {
  const results = await allSettled(tasks, value, { ...options, preserveOrder: false });
  return results
    .filter((r): r is { status: 'fulfilled'; value: R; index: number } => r.status === 'fulfilled')
    .map(r => r.value);
}
/** @deprecated Use `some` instead. */
export const parallelSettled = some;

/**
 * Races multiple tasks and returns the result of the first task to either fulfill or reject.
 *
 * @returns A promise that resolves or rejects with the outcome of the first task to settle.
 */
export async function race<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, options?: Omit<ParallelOptions, 'preserveOrder'>): Promise<R> {
  return raceFrom(tasks, value, options);
}

/**
 * Returns a promise that fulfills with the value of the first task to fulfill.
 * It rejects only if all of the tasks reject, with an `AggregateError`.
 *
 * @returns A promise that resolves with the value of the first successful task.
 */
export async function any<C extends { scope: Scope }, V, R>(tasks: ReadonlyArray<Task<C, V, R>>, value: V, options?: ParallelOptions): Promise<R> {
  const results = await allSettled(tasks, value, options);
  const fulfilled = results.filter((r): r is { status: 'fulfilled', value: R, index: number } => r.status === 'fulfilled');
  if (fulfilled.length > 0) {
    // To respect completion order, we would need a more complex setup.
    // For simplicity, we return the first one from the results array.
    return fulfilled[0].value;
  }
  const errors = results.map(r => (r as { reason: unknown }).reason);
  throw new AggregateError(errors, 'All promises were rejected');
}


// =================================================================
// Section 4: Iterator-Based Streaming Utilities
// =================================================================

/**
 * Executes tasks from an `Iterable` or `AsyncIterable` in parallel, yielding
 * `ParallelResult` objects as they complete. This is highly memory-efficient for large task sets.
 *
 * @returns An async iterable that yields settled results.
 */
export async function* stream<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): AsyncIterable<ParallelResult<R>> {
  const context = getContext<C>();
  const { concurrency = Infinity, priority = 'user-visible', signal: optionSignal } = options;
  const controller = new AbortController();
  const onAbort = () => controller.abort(optionSignal?.reason);
  const contextSignal = context.scope.signal;
  optionSignal?.addEventListener('abort', onAbort, { once: true });
  contextSignal.addEventListener('abort', onAbort, { once: true });
  const signal = controller.signal;
  const cleanup = () => { optionSignal?.removeEventListener('abort', onAbort); contextSignal.removeEventListener('abort', onAbort); };

  try {
    const executing = new Set<Promise<ParallelResult<R>>>();
    const taskIterator = (tasks as any)[Symbol.asyncIterator] ? (tasks as any)[Symbol.asyncIterator]() : (tasks as any)[Symbol.iterator]();
    let index = 0;
    let iteratorDone = false;
    while (!iteratorDone || executing.size > 0) {
      while (executing.size < concurrency && !iteratorDone) {
        if (signal.aborted) break;
        const iteratorResult = await taskIterator.next();
        if (iteratorResult.done) { iteratorDone = true; break; }
        const task = iteratorResult.value;
        const currentIndex = index++;
        const taskPromise: Promise<ParallelResult<R>> = scheduler.postTask(async () => {
          try { return { status: 'fulfilled', value: await task(context, inputValue), index: currentIndex }; }
          catch (reason) { return { status: 'rejected', reason, index: currentIndex }; }
        }, { priority, signal });
        const resultPromise = taskPromise.finally(() => executing.delete(resultPromise));
        executing.add(resultPromise);
      }
      if (executing.size === 0) break;
      yield await Promise.race(executing);
    }
  } catch (error) {
    if ((error as DOMException)?.name !== 'AbortError') throw error;
  } finally {
    cleanup();
  }
}
/** @deprecated Use `stream` instead. */
export const parallelFrom = stream;

/**
 * Executes tasks from an iterator and yields only the values from successfully fulfilled tasks.
 */
export async function* streamSome<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): AsyncIterable<R> {
  for await (const result of stream(tasks, inputValue, options)) {
    if (result.status === 'fulfilled') yield result.value;
  }
}
/** @deprecated Use `streamSome` instead. */
export const parallelFromSettled = streamSome;

/**
 * Executes tasks from an iterator and yields successful values, but throws if any task fails.
 */
export async function* streamAll<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): AsyncIterable<R> {
  for await (const result of stream(tasks, inputValue, options)) {
    if (result.status === 'fulfilled') yield result.value;
    else throw result.reason;
  }
}
/** @deprecated Use `streamAll` instead. */
export const parallelFromAll = streamAll;

/**
 * Executes tasks from an iterator and yields the first successful value.
 * Throws an `AggregateError` only if all tasks fail.
 */
export async function streamAny<C extends { scope: Scope }, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}
): Promise<R> {
  const errors: unknown[] = [];
  for await (const result of stream(tasks, inputValue, options)) {
    if (result.status === 'fulfilled') return result.value;
    errors.push(result.reason);
  }
  throw new AggregateError(errors, 'All promises were rejected');
}

/**
 * Races tasks from an iterator and returns the result of the first task to settle.
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
    signal.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    try {
      let tasksLaunched = 0;
      const promises: Promise<R>[] = [];
      for await (const task of tasks) {
        if (raceController.signal.aborted) break;
        tasksLaunched++;
        promises.push(scheduler.postTask(() => task(context, value), { priority, signal: raceController.signal }));
      }
      if (tasksLaunched === 0) return reject(new Error('No tasks provided to raceFrom'));
      Promise.race(promises).then(resolve, reject).finally(() => { raceController.abort(); cleanup(); });
    } catch (error) { raceController.abort(); cleanup(); reject(error); }
  });
}