/**
 * @module
 * This module provides a powerful and comprehensive suite of utilities for executing
 * tasks in parallel. It offers fine-grained control over concurrency, scheduling,
 * and result handling, for both arrays and iterables of tasks.
 */

import type { Task, Scope, BaseContext } from './run'; // Assuming BaseContext includes Scope
import { getContext } from './run'; // Used by stream utilities and allSettled/all etc. for default context

// =================================================================
// Section 1: Core Types and Scheduler Definition
// =================================================================

/**
 * Defines the priority levels for task scheduling.
 * - `user-blocking`: Highest priority, for tasks critical to user interaction (e.g., animations, input responses).
 * - `user-visible`: Default priority, for tasks that update the UI but are not immediately blocking.
 * - `background`: Lowest priority, for tasks that can be deferred (e.g., logging, pre-fetching).
 */
export type TaskPriority = 'user-blocking' | 'user-visible' | 'background';

/**
 * Provides a set of options to control the execution behavior of parallel operations.
 */
export interface ParallelOptions {
  /**
   * The maximum number of tasks that are allowed to run concurrently.
   * @default Infinity (no limit)
   */
  concurrency?: number;
  /**
   * The priority for the scheduled tasks, influencing how they are queued by the scheduler.
   * @default 'user-visible'
   */
  priority?: TaskPriority;
  /**
   * If true, tasks are processed in sequential batches. When batching is enabled,
   * the `concurrency` option typically applies to how many batches run in parallel,
   * or how many items *within* a batch run in parallel if the scheduler implementation
   * and batch execution logic support it.
   * The current `executeBatched` runs batches sequentially, with parallelism within each batch.
   * @default false
   */
  batching?: boolean;
  /**
   * The number of tasks to include in each batch when `batching` is enabled.
   * @default 10
   */
  batchSize?: number;
  /**
   * If true, the results array from array-based operations (`all`, `allSettled`)
   * will have the same order as the input tasks array.
   * For stream-based operations, this option is usually ignored as results are yielded on completion.
   * @default true
   */
  preserveOrder?: boolean;
  /**
   * An optional `AbortSignal` to cancel the entire parallel operation.
   * If not provided, it defaults to the `context.scope.signal` of the context
   * in which the parallel utility is invoked.
   */
  signal?: AbortSignal;
}

/**
 * Represents the settled result of a single task executed within a parallel operation
 * like `allSettled` or `stream`.
 * @template T The type of the value if the task is fulfilled.
 */
export type ParallelResult<T> =
  | { status: 'fulfilled'; value: T; index: number }
  | { status: 'rejected'; reason: unknown; index: number };

/**
 * Defines the contract for a task scheduler, responsible for executing callbacks
 * (typically wrapping task executions) according to priority and cancellation signals.
 */
export interface Scheduler {
  /**
   * Schedules a callback function to be executed.
   * @template T The result type of the callback.
   * @param callback The function to execute.
   * @param options Optional scheduling parameters like priority and signal.
   * @returns A Promise that resolves or rejects with the callback's outcome.
   */
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T>;
  /** Indicates if the scheduler is using a native browser/environment scheduling API. */
  readonly isNative: boolean;
}

class NativeScheduler implements Scheduler {
  readonly isNative = true;

  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T> {
    // Check for native scheduler API (e.g., browser's `scheduler.postTask`)
    if (typeof globalThis !== 'undefined' && 'scheduler' in globalThis && globalThis.scheduler && typeof (globalThis.scheduler as any).postTask === 'function') {
      return (globalThis.scheduler as any).postTask(callback, options);
    }

    // Fallback if native scheduler.postTask is not available
    const delay = options?.priority === 'background' ? 250 : options?.priority === 'user-visible' ? 4 : 0; // Small delay for non-blocking
    return new Promise<T>((resolve, reject) => {
      if (options?.signal?.aborted) {
        return reject(options.signal.reason instanceof Error ? options.signal.reason : new DOMException('Aborted', 'AbortError'));
      }
      const timeoutId = setTimeout(async () => {
        // Double-check signal before execution, though addEventListener should handle most cases
        if (options?.signal?.aborted) {
          reject(options.signal.reason instanceof Error ? options.signal.reason : new DOMException('Aborted', 'AbortError'));
          return;
        }
        try {
          resolve(await callback());
        } catch (error) {
          reject(error);
        }
      }, delay);

      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        reject(options.signal!.reason instanceof Error ? options.signal!.reason : new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  }
}

class PromiseScheduler implements Scheduler {
  readonly isNative = false;

  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: TaskPriority; signal?: AbortSignal }): Promise<T> {
    if (!options) options = {}
    return new Promise<T>((resolve, reject) => {
      if (options?.signal?.aborted) {
        return reject(options.signal.reason instanceof Error ? options.signal.reason : new DOMException('Aborted', 'AbortError'));
      }

      const abortHandler = () => {
        reject(options.signal!.reason instanceof Error ? options.signal!.reason : new DOMException('Aborted', 'AbortError'));
      };
      options?.signal?.addEventListener('abort', abortHandler, { once: true });

      const taskFn = async () => {
        // Listener cleanup is important before potentially long-running callback
        options?.signal?.removeEventListener('abort', abortHandler);
        if (options?.signal?.aborted) {
          // Already aborted by the time it was scheduled to run (or listener fired just before this check)
          return; // The promise is already rejected by abortHandler
        }
        try {
          resolve(await callback());
        } catch (error) {
          reject(error);
        }
      };

      if (options?.priority === 'user-blocking') {
        queueMicrotask(taskFn);
      } else if (options?.priority === 'background') {
        setTimeout(taskFn, 4); // Small delay for background tasks to yield to more important ones
      } else { // 'user-visible' or undefined priority
        setTimeout(taskFn, 0); // Standard macrotask deferral
      }
    });
  }
}

interface ExperimentalScheduler {
  postTask<T>(
    callback: () => T | Promise<T>,
    options?: { priority?: 'user-blocking' | 'user-visible' | 'background'; signal?: AbortSignal }
  ): Promise<T>;
}

declare global {
  var scheduler: ExperimentalScheduler | undefined; // This makes `globalThis.scheduler` known
}

/**
 * Gets the best available scheduler for the current environment.
 * It prefers a native scheduler if `globalThis.scheduler.postTask` is available,
 * otherwise, it falls back to a promise-based scheduler using `queueMicrotask` and `setTimeout`.
 */
export function getScheduler(): Scheduler {

  if (typeof globalThis !== 'undefined' && 'scheduler' in globalThis && globalThis.scheduler && typeof (globalThis.scheduler as any).postTask === 'function') {
    return new NativeScheduler();
  }
  return new PromiseScheduler();
}

/** A shared, default instance of the scheduler, determined at module load time. */
export const scheduler = getScheduler();


// =================================================================
// Section 2: Core Parallel Execution Engine (`allSettled`)
// =================================================================

/**
 * Executes an array of `Task` functions in parallel and returns an array of `ParallelResult`
 * objects, reflecting the outcome (fulfilled or rejected) of each task.
 * This function itself does not reject based on task failures; it always resolves
 * with the settlement status of all provided tasks. It serves as the robust foundation
 * for other higher-level parallel utilities.
 *
 * Cancellation is managed by an `AbortController` that links the `options.signal`
 * (if provided) and the `context.scope.signal`.
 *
 * @template C The context type, which must include `scope`.
 * @template V The common input value type passed to each task.
 * @template R The result type of the tasks if fulfilled.
 * @param tasks An array of `Task<C, V, R>` functions to execute.
 * @param value The common input value `V` that will be passed to each task.
 * @param options Optional `ParallelOptions` to control execution behavior (concurrency, priority, etc.).
 * @param providedContext Optional explicit context `C` to use. If not provided,
 *                        it's retrieved via the global `getContext<C>()`.
 * @returns A Promise that resolves to an array of `ParallelResult<R>` objects.
 */
export async function allSettled<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options: ParallelOptions = {},
  providedContext?: C
): Promise<ParallelResult<R>[]> {
  // Determine the context: use provided or get from ambient.
  // This `getContext` call relies on the global "smart" context resolution from `run.ts`.
  const context = providedContext || getContext<C>();

  // Resolve final options, defaulting where necessary.
  const finalOptions: Required<Omit<ParallelOptions, 'batchSize'>> & { batchSize: number } = {
    concurrency: options.concurrency ?? Infinity,
    priority: options.priority ?? 'user-visible',
    batching: options.batching ?? false,
    batchSize: options.batchSize ?? 10, // Default for batchSize
    preserveOrder: options.preserveOrder ?? true,
    signal: options.signal ?? context.scope.signal, // Default to context's scope signal
  };

  if (!tasks || tasks.length === 0) {
    return [];
  }

  // Aggregate cancellation: if either the options.signal or context.scope.signal aborts,
  // the internal signal for scheduled tasks will be aborted.
  const operationAbortController = new AbortController();
  const abortOverallOperation = (reason?: any) => {
    // Ensure reason is an Error for AbortController
    const abortReason = reason instanceof Error ? reason : new DOMException(String(reason ?? 'Operation aborted'), 'AbortError');
    operationAbortController.abort(abortReason);
  };

  finalOptions.signal.addEventListener('abort', () => abortOverallOperation(finalOptions.signal.reason), { once: true });
  // Also listen to the primary context's signal if it's different from finalOptions.signal
  if (context.scope.signal !== finalOptions.signal) {
    context.scope.signal.addEventListener('abort', () => abortOverallOperation(context.scope.signal.reason), { once: true });
  }

  // Options to be passed to internal execution strategies, using the aggregated signal.
  const executionOptions: Required<ParallelOptions> = { ...finalOptions, signal: operationAbortController.signal };

  try {
    if (executionOptions.batching) {
      return await executeBatched(tasks, value, context, executionOptions);
    } else if (executionOptions.concurrency === Infinity || tasks.length <= executionOptions.concurrency) {
      // If concurrency is Infinity or tasks length is within limit, use unlimited.
      // This also handles cases where concurrency might be set to 0 or negative by mistake, defaulting to unlimited.
      return await executeUnlimited(tasks, value, context, executionOptions);
    } else {
      return await executeLimited(tasks, value, context, executionOptions);
    }
  } finally {
    // Cleanup listeners to prevent memory leaks if signals are long-lived.
    // {once: true} should handle this, but explicit removal is safer.
    finalOptions.signal.removeEventListener('abort', () => abortOverallOperation(finalOptions.signal.reason));
    if (context.scope.signal !== finalOptions.signal) {
      context.scope.signal.removeEventListener('abort', () => abortOverallOperation(context.scope.signal.reason));
    }
    // If the operation completes before any abort, ensure the controller is aborted
    // to signal any pending scheduler.postTask calls that might not have started.
    if (!operationAbortController.signal.aborted) {
      operationAbortController.abort(new DOMException('Operation normally concluded', 'AbortError'));
    }
  }
}

/** @deprecated Use `allSettled` for capturing all outcomes. This alias might be confusing. */
export const parallel = allSettled;


// --- Internal Execution Helper Implementations ---

async function executeUnlimited<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  context: C,
  options: Required<ParallelOptions>
): Promise<ParallelResult<R>[]> {
  const { priority, signal } = options;
  const promises = tasks.map((taskFn, index) =>
    scheduler.postTask(async (): Promise<ParallelResult<R>> => {
      // Check signal before starting the actual task, postTask might also do this
      if (signal.aborted) {
        return { status: 'rejected', reason: signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'), index };
      }
      try {
        return { status: 'fulfilled', value: await taskFn(context, value), index };
      } catch (reason) {
        return { status: 'rejected', reason, index };
      }
    }, { priority, signal })
  );
  return Promise.all(promises); // Promise.all on promises of ParallelResult
}

async function executeLimited<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  context: C,
  options: Required<ParallelOptions>
): Promise<ParallelResult<R>[]> {
  const { concurrency, priority, signal, preserveOrder } = options;
  const results: ParallelResult<R>[] = preserveOrder ? new Array(tasks.length).fill(undefined) : [];
  const executing = new Set<Promise<void>>(); // Stores promises that resolve when a slot is free
  let taskIndex = 0;

  return new Promise<ParallelResult<R>[]>((resolve, reject) => {
    const checkDone = () => {
      // Resolve once all tasks have been initiated and completed
      if (taskIndex === tasks.length && executing.size === 0) {
        resolve(results.filter(r => r !== undefined)); // Filter out empty slots if preserveOrder was true and some aborted early
      }
    };

    const scheduleNext = () => {
      while (executing.size < concurrency && taskIndex < tasks.length) {
        if (signal.aborted) {
          // If aborted, reject remaining tasks implicitly or fill with abort errors
          for (let j = taskIndex; j < tasks.length; j++) {
            if (preserveOrder && results[j] === undefined) {
              results[j] = { status: 'rejected', reason: signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'), index: j };
            }
          }
          // Ensure the main promise resolves/rejects correctly based on overall status
          // If already aborted, this loop might not even start fully.
          // The outer try/finally in allSettled or the signal on scheduler.postTask handles overall abort.
          // Here we ensure we stop scheduling new tasks.
          taskIndex = tasks.length; // Mark all as "processed"
          checkDone();
          return;
        }

        const currentIndex = taskIndex++;
        const taskFn = tasks[currentIndex];

        const promise = scheduler.postTask(async () => {
          if (signal.aborted && (!preserveOrder || results[currentIndex] === undefined)) {
            // If aborted before taskFn runs AND we haven't already recorded a result for this index
            const settledResult: ParallelResult<R> = { status: 'rejected', reason: signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'), index: currentIndex };
            preserveOrder ? (results[currentIndex] = settledResult) : results.push(settledResult);
            return;
          }
          try {
            const resultValue = await taskFn(context, value);
            const settledResult: ParallelResult<R> = { status: 'fulfilled', value: resultValue, index: currentIndex };
            preserveOrder ? (results[currentIndex] = settledResult) : results.push(settledResult);
          } catch (reason) {
            const settledResult: ParallelResult<R> = { status: 'rejected', reason, index: currentIndex };
            preserveOrder ? (results[currentIndex] = settledResult) : results.push(settledResult);
          }
        }, { priority, signal })
          .finally(() => {
            executing.delete(promise);
            scheduleNext(); // Try to schedule another task
            checkDone();
          });
        executing.add(promise);
      }
    };

    signal.addEventListener('abort', () => {
      // If overall operation is aborted, ensure we resolve/reject the main promise.
      // Fill remaining results with abort error if preserving order.
      for (let j = 0; j < tasks.length; j++) { // Check all slots
        if (preserveOrder && results[j] === undefined) {
          results[j] = { status: 'rejected', reason: signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'), index: j };
        }
      }
      // If preserveOrder is false, tasks might not have been pushed if aborted early.
      // The current logic for checkDone should handle resolving.
      // We might need to reject the main promise if signal aborts everything before completion.
      // However, allSettled is designed to never reject based on task failures.
      // The scheduler.postTask calls will individually reject/fulfill based on the signal.
      // The checkDone will eventually resolve the results array.
      // If the signal aborts *this main promise*, it should be handled by caller of executeLimited.
      // The `finally` in `allSettled` will handle its AbortController.
      // This event listener is primarily to stop scheduling new tasks if an external signal aborts.
      scheduleNext(); // Attempt to clean up / fill in results
      checkDone();
    }, { once: true });

    scheduleNext(); // Initial scheduling
  });
}


async function executeBatched<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  context: C,
  options: Required<ParallelOptions>
): Promise<ParallelResult<R>[]> {
  const { batchSize, priority, signal, preserveOrder } = options;
  const allResults: ParallelResult<R>[] = [];

  for (let i = 0; i < tasks.length; i += batchSize) {
    if (signal.aborted) {
      // If aborted, fill remaining results for preserveOrder, then break
      if (preserveOrder) {
        for (let j = i; j < tasks.length; j++) {
          allResults[j] = { status: 'rejected', reason: signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'), index: j };
        }
      }
      break; // Stop processing further batches
    }
    const batchTasks = tasks.slice(i, i + batchSize);

    // Each batch is posted as a single meta-task to the scheduler.
    // Inside this meta-task, Promise.all runs the actual tasks of the batch.
    const batchSettledResults = await scheduler.postTask(async () =>
      Promise.all( // This Promise.all is for results within a batch
        batchTasks.map(async (taskFn, batchTaskIndex) => {
          const originalIndex = i + batchTaskIndex;
          if (signal.aborted) { // Check signal for each task in batch too
            return { status: 'rejected', reason: signal.reason instanceof Error ? signal.reason : new DOMException('Aborted', 'AbortError'), index: originalIndex } as ParallelResult<R>;
          }
          try {
            return { status: 'fulfilled', value: await taskFn(context, value), index: originalIndex } as ParallelResult<R>;
          } catch (reason) {
            return { status: 'rejected', reason, index: originalIndex } as ParallelResult<R>;
          }
        })
      )
      , { priority, signal });

    // If preserveOrder is true, we need to place results at correct indices.
    // However, executeBatched processes batches sequentially and results are pushed sequentially.
    // So, if preserveOrder is true, the overall order of results from allResults.push
    // will naturally match the input task order.
    allResults.push(...batchSettledResults);
  }
  // If preserveOrder was true and some batches were skipped due to abort, allResults might be shorter.
  // The current logic correctly fills only processed batches. If strict array length is needed, fill with aborts.
  // But `allSettled` usually returns results for tasks it attempted.
  return allResults;
}


// =================================================================
// Section 3: High-Level Parallel Helpers for Arrays (all, some, race, any)
// =================================================================

/**
 * Executes an array of tasks in parallel. If any task rejects, this function
 * immediately rejects with that task's reason (fail-fast behavior, like `Promise.all`).
 * If all tasks fulfill, it resolves with an array of their values, in the same
 * order as the input tasks.
 *
 * @template C The context type.
 * @template V The common input value for each task.
 * @template R The result type of the tasks.
 * @param tasks An array of `Task<C, V, R>` to execute.
 * @param value The common input value `V` passed to each task.
 * @param options Optional `ParallelOptions`. `preserveOrder` is forced to `true`.
 * @param providedContext Optional explicit context `C`.
 * @returns A Promise resolving to `R[]` or rejecting with the first error.
 */
export async function all<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: ParallelOptions,
  providedContext?: C
): Promise<R[]> {
  // `allSettled` is used as the engine; `preserveOrder: true` is critical for `all`.
  const settledResults = await allSettled(tasks, value, { ...options, preserveOrder: true }, providedContext);

  const values: R[] = new Array(settledResults.length);
  for (const result of settledResults) {
    if (result.status === 'rejected') {
      throw result.reason; // Fail-fast
    }
    // result.index is guaranteed by preserveOrder: true from allSettled
    values[result.index] = result.value;
  }
  return values;
}
/** @deprecated Use `all` for Promise.all-like behavior. */
export const parallelAll = all;

/**
 * Executes an array of tasks in parallel and resolves with an array containing
 * only the values from successfully fulfilled tasks. Failures are ignored.
 * The order of results is not guaranteed (completion order).
 *
 * @returns A Promise resolving to an array of successfully fulfilled values `R[]`.
 */
export async function some<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: Omit<ParallelOptions, 'preserveOrder'>, // preserveOrder is effectively false
  providedContext?: C
): Promise<R[]> {
  // For `some`, order of results doesn't typically matter, so preserveOrder: false.
  const settledResults = await allSettled(tasks, value, { ...options, preserveOrder: false }, providedContext);

  return settledResults
    .filter((r): r is { status: 'fulfilled'; value: R; index: number } => r.status === 'fulfilled')
    .map(r => r.value);
}
/** @deprecated Use `some` for collecting successful results. */
export const parallelSettled = some; // This alias was confusing; `some` is better.

/**
 * Races multiple tasks from an array. Resolves or rejects with the outcome
 * (value or reason) of the first task to settle (fulfill or reject).
 *
 * @returns A Promise that mirrors the first task to settle.
 */
export async function race<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: Omit<ParallelOptions, 'preserveOrder' | 'batching'>, // These don't apply to race
  providedContext?: C
): Promise<R> {
  // `raceFrom` is suitable for arrays as well.
  return raceFrom(tasks, value, options, providedContext);
}

/**
 * Executes tasks in parallel. Resolves with the value of the first task to fulfill.
 * If all tasks reject, it rejects with an `AggregateError` containing all rejection reasons.
 * (Behavior similar to `Promise.any`).
 *
 * @returns A Promise resolving with the value of the first successful task `R`.
 */
export async function any<C extends BaseContext, V, R>(
  tasks: ReadonlyArray<Task<C, V, R>>,
  value: V,
  options?: ParallelOptions, // preserveOrder might affect which "first" is chosen if multiple fulfill simultaneously
  providedContext?: C
): Promise<R> {
  // `allSettled` will run all. We then find the first fulfilled.
  // If preserveOrder is false, it might be faster to find the first actual fulfillment.
  // But using allSettled is simpler.
  const settledResults = await allSettled(tasks, value, options, providedContext);

  // Iterate in original order (if preserveOrder=true) or completion order (if preserveOrder=false and results are sorted by completion)
  // For simplicity, current allSettled's preserveOrder=true returns in original index order.
  for (const result of settledResults) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  // If no task fulfilled:
  const errors = settledResults.map(r => (r as { status: 'rejected'; reason: unknown; index: number }).reason);
  throw new AggregateError(errors, 'All tasks were rejected');
}


// =================================================================
// Section 4: Iterator-Based Streaming Utilities
// =================================================================

/**
 * Executes tasks from an `Iterable` or `AsyncIterable` in parallel, yielding
 * `ParallelResult` objects as tasks settle (fulfill or reject).
 * This is highly memory-efficient for processing large or indefinite sets of tasks,
 * as it does not require all tasks to be held in memory simultaneously.
 * Concurrency is managed to avoid overwhelming resources.
 *
 * @template C The context type.
 * @template V The common input value for each task.
 * @template R The result type of the tasks.
 * @param tasks An `Iterable` or `AsyncIterable` yielding `Task<C, V, R>`.
 * @param inputValue The common input value `V` passed to each task.
 * @param options Optional `ParallelOptions`. `preserveOrder` and `batching` are not applicable
 *                and are omitted from the options type for `stream`.
 * @returns An `AsyncIterable<ParallelResult<R>>` yielding settled results.
 */
export async function* stream<C extends BaseContext, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {}, // These options don't make sense for stream
  providedContext?: C
): AsyncIterable<ParallelResult<R>> {
  const context = providedContext || getContext<C>();
  const {
    concurrency = Infinity,
    priority = 'user-visible',
    signal: optionSignal, // Signal specifically from options
  } = options;

  // Aggregate cancellation signals
  const operationAbortController = new AbortController();
  const abortOverallOperation = (reason?: any) => {
    const abortReason = reason instanceof Error ? reason : new DOMException(String(reason ?? 'Operation aborted'), 'AbortError');
    operationAbortController.abort(abortReason);
  };

  const contextSignal = context.scope.signal;
  optionSignal?.addEventListener('abort', () => abortOverallOperation(optionSignal.reason), { once: true });
  contextSignal.addEventListener('abort', () => abortOverallOperation(contextSignal.reason), { once: true });

  const executionSignal = operationAbortController.signal; // Use this for all posted tasks

  const cleanupEventListeners = () => {
    optionSignal?.removeEventListener('abort', () => abortOverallOperation(optionSignal.reason));
    contextSignal.removeEventListener('abort', () => abortOverallOperation(contextSignal.reason));
  };

  try {
    const executing = new Set<Promise<ParallelResult<R>>>();
    // Type a bit more explicitly for the iterator
    let taskIterator: AsyncIterator<Task<C, V, R>> | Iterator<Task<C, V, R>>;
    if (Symbol.asyncIterator in tasks) {
      taskIterator = (tasks as AsyncIterable<Task<C, V, R>>)[Symbol.asyncIterator]();
    } else {
      taskIterator = (tasks as Iterable<Task<C, V, R>>)[Symbol.iterator]();
    }

    let index = 0; // Index for ParallelResult, reflects order of task issuance
    let iteratorDone = false;

    const scheduleNextTask = async () => {
      if (iteratorDone || executionSignal.aborted) return;

      const iteratorResult = await taskIterator.next();
      if (iteratorResult.done) {
        iteratorDone = true;
        return;
      }

      const taskFn = iteratorResult.value;
      const currentIndex = index++;

      const taskPromise = scheduler.postTask(async (): Promise<ParallelResult<R>> => {
        if (executionSignal.aborted) { // Check before expensive work
          return { status: 'rejected', reason: executionSignal.reason ?? new DOMException('Aborted', 'AbortError'), index: currentIndex };
        }
        try {
          return { status: 'fulfilled', value: await taskFn(context, inputValue), index: currentIndex };
        } catch (reason) {
          return { status: 'rejected', reason, index: currentIndex };
        }
      }, { priority, signal: executionSignal });

      // Manage the set of executing promises
      const wrappedPromise = taskPromise.finally(() => executing.delete(wrappedPromise));
      executing.add(wrappedPromise);
    };

    // Initial fill of the concurrency pool
    for (let i = 0; i < concurrency && !iteratorDone; i++) {
      await scheduleNextTask(); // await to respect initial fill up to concurrency
    }

    // Main loop: yield settled promises and replenish the pool
    while (executing.size > 0) {
      if (executionSignal.aborted && executing.size > 0) {
        // If aborted, wait for all currently executing tasks to settle (or be cancelled by signal)
        // then break. New tasks are no longer scheduled.
        try {
          const resultsToDrain = await Promise.allSettled(executing);
          for (const resProm of resultsToDrain) { // Yield any results that came from promises that settled before finally was run
            if (resProm.status === 'fulfilled' && resProm.value) yield resProm.value;
          }
        } catch (e) { /* Drain errors already handled by individual task wrappers */ }
        break;
      }

      // Yield the result of the next task that settles
      const settledResult = await Promise.race(executing);
      yield settledResult;
      // Since `finally` removes the promise from `executing`, no explicit removal needed here.

      // If not done iterating and not aborted, try to schedule another task
      if (!iteratorDone && !executionSignal.aborted) {
        await scheduleNextTask();
      }
    }
  } catch (error) {
    // Catch errors from taskIterator.next() or other unexpected issues.
    // AbortErrors from within the loop should be handled by individual tasks.
    if (!((error instanceof DOMException) && error.name === 'AbortError')) {
      // If it's not an AbortError related to our executionSignal, rethrow
      if (error !== executionSignal.reason) {
        throw error;
      }
    }
    // If it IS an AbortError from our signal, the loop should have exited gracefully.
  } finally {
    cleanupEventListeners();
    // Ensure the controller is aborted if the loop exits for any other reason
    // and it hasn't been aborted yet (e.g. iterator exhaustion).
    if (!operationAbortController.signal.aborted) {
      operationAbortController.abort(new DOMException('Stream processing concluded.', 'AbortError'));
    }
  }
}
/** @deprecated Use `stream` for settled results from an iterable. */
export const parallelFrom = stream;


/**
 * Executes tasks from an `Iterable` or `AsyncIterable` in parallel and yields
 * only the values from successfully fulfilled tasks, ignoring rejections.
 * Results are yielded as they become available (completion order).
 */
export async function* streamSome<C extends BaseContext, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {},
  providedContext?: C
): AsyncIterable<R> {
  for await (const result of stream(tasks, inputValue, options, providedContext)) {
    if (result.status === 'fulfilled') {
      yield result.value;
    }
  }
}
/** @deprecated Use `streamSome` for fulfilled results from an iterable. */
export const parallelFromSettled = streamSome;


/**
 * Executes tasks from an `Iterable` or `AsyncIterable` in parallel.
 * Yields values from successfully fulfilled tasks. If any task rejects,
 * the iteration immediately stops and the error is thrown (fail-fast).
 */
export async function* streamAll<C extends BaseContext, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {},
  providedContext?: C
): AsyncIterable<R> {
  for await (const result of stream(tasks, inputValue, options, providedContext)) {
    if (result.status === 'fulfilled') {
      yield result.value;
    } else {
      throw result.reason; // Fail-fast
    }
  }
}
/** @deprecated Use `streamAll` for fail-fast iteration. */
export const parallelFromAll = streamAll;


/**
 * Executes tasks from an `Iterable` or `AsyncIterable` in parallel.
 * Resolves with the value of the first task to fulfill.
 * If all tasks reject, it rejects with an `AggregateError` containing all rejection reasons.
 */
export async function streamAny<C extends BaseContext, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  inputValue: V,
  options: Omit<ParallelOptions, 'preserveOrder' | 'batching'> = {},
  providedContext?: C
): Promise<R> {
  const errors: unknown[] = [];
  for await (const result of stream(tasks, inputValue, options, providedContext)) {
    if (result.status === 'fulfilled') {
      return result.value; // First one to fulfill
    }
    errors.push(result.reason);
  }
  // If loop completes, no task fulfilled
  throw new AggregateError(errors, 'All tasks from iterable were rejected');
}


/**
 * Races tasks from an `Iterable` or `AsyncIterable`. Resolves or rejects with
 * the outcome (value or reason) of the first task to settle.
 * Other pending tasks are signalled to abort.
 *
 * @template C The context type.
 * @template V The common input value for each task.
 * @template R The result type of the tasks.
 * @param tasks An `Iterable` or `AsyncIterable` yielding `Task<C, V, R>`.
 * @param value The common input value `V` passed to each task.
 * @param options Optional `ParallelOptions` (excluding `preserveOrder`, `batching`).
 *                Only `priority` and `signal` are typically relevant.
 * @param providedContext Optional explicit context `C`.
 * @returns A Promise that mirrors the first task to settle.
 */
export function raceFrom<C extends BaseContext, V, R>(
  tasks: Iterable<Task<C, V, R>> | AsyncIterable<Task<C, V, R>>,
  value: V,
  options?: Omit<ParallelOptions, 'preserveOrder' | 'batching'>,
  providedContext?: C
): Promise<R> {
  const context = providedContext || getContext<C>();
  const { priority = 'user-visible', signal: optionSignal } = options || {};

  // This outer promise will settle with the first task that settles.
  return new Promise<R>(async (resolve, reject) => {
    // Aggregate signals: optionSignal and context.scope.signal
    // If either aborts, the overall race operation (and its internal controller) should abort.
    const overallAbortController = new AbortController();
    const onOverallAbort = (reason?: any) => {
      const abortReason = reason instanceof Error ? reason : new DOMException(String(reason ?? 'Race operation aborted'), 'AbortError');
      overallAbortController.abort(abortReason);
    };

    const signalsToWatch: AbortSignal[] = [];
    if (optionSignal) signalsToWatch.push(optionSignal);
    if (context.scope.signal && context.scope.signal !== optionSignal) { // Avoid duplicate listeners
      signalsToWatch.push(context.scope.signal);
    }

    signalsToWatch.forEach(sig => sig.addEventListener('abort', () => onOverallAbort(sig.reason), { once: true }));

    const cleanupEventListeners = () => {
      signalsToWatch.forEach(sig => sig.removeEventListener('abort', () => onOverallAbort(sig.reason)));
    };

    if (overallAbortController.signal.aborted) {
      return reject(overallAbortController.signal.reason);
    }

    // This controller is used to cancel other tasks once one has settled.
    const internalRaceController = new AbortController();
    const onInternalAbort = () => internalRaceController.abort(); // No reason needed for internal controller
    overallAbortController.signal.addEventListener('abort', onInternalAbort, { once: true });


    let tasksLaunched = 0;
    let settled = false; // Flag to ensure resolve/reject only happens once

    const settlePromise = (settleFn: (val: any) => void, val: any) => {
      if (!settled) {
        settled = true;
        internalRaceController.abort(); // Abort other tasks
        cleanupEventListeners();
        overallAbortController.abort(); // Also abort the overall controller to clean its listeners
        settleFn(val);
      }
    };

    try {
      let taskIterator: AsyncIterator<Task<C, V, R>> | Iterator<Task<C, V, R>>;
      if (Symbol.asyncIterator in tasks) {
        taskIterator = (tasks as AsyncIterable<Task<C, V, R>>)[Symbol.asyncIterator]();
      } else {
        taskIterator = (tasks as Iterable<Task<C, V, R>>)[Symbol.iterator]();
      }

      for (; ;) { // Loop to pull from iterator
        if (overallAbortController.signal.aborted || internalRaceController.signal.aborted) break;

        let iteratorResult;
        try {
          iteratorResult = await taskIterator.next();
        } catch (iterError) { // Error from the iterator itself
          settlePromise(reject, iterError);
          break;
        }

        if (iteratorResult.done) {
          if (tasksLaunched === 0 && !settled) {
            // Iterator was empty or completed without yielding tasks after race started
            settlePromise(reject, new Error('No tasks provided to raceFrom or iterator exhausted early.'));
          }
          break; // Iterator is exhausted
        }

        tasksLaunched++;
        const taskFn = iteratorResult.value;

        // Schedule the task. If it settles first, it will resolve/reject the outer promise.
        scheduler.postTask(() => taskFn(context, value), {
          priority,
          signal: internalRaceController.signal // Each task listens to the internal controller
        })
          .then(res => settlePromise(resolve, res))
          .catch(err => settlePromise(reject, err));
      }
      // If loop finishes and !settled and tasksLaunched > 0, it means all launched tasks are pending.
      // Promise.race behavior is to wait. This will be handled by the .then/.catch above.
      // If tasksLaunched === 0 and !settled (and iterator wasn't empty initially), implies overall abort.
      if (tasksLaunched === 0 && !settled && overallAbortController.signal.aborted) {
        settlePromise(reject, overallAbortController.signal.reason);
      }

    } catch (error) { // Catch errors from iterating `tasks` itself if it's an async iterable that rejects
      settlePromise(reject, error);
    }
    // No finally cleanup here for event listeners as settlePromise handles it
  });
}