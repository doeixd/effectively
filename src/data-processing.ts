/**
 * @module
 * This module provides high-level utilities for parallel data processing. It
 * includes abstractions like `mapReduce`, parallel `filter`, and parallel
 * `groupBy` to operate on collections of data concurrently, leveraging the
 * scheduler from './scheduler.ts' for parallel execution.
 */

import {
  defineTask, // Globally imported, smart defineTask
  getContext, // Used in groupBy if keyingTaskOrFn is a function needing context
  type Task,
  type BaseContext,
  type Scope, // Assuming BaseContext implies Scope
} from './run';

// Import `all` and `allSettled` from the provided scheduler.ts
// These functions expect an array of Tasks and a single common input value for those tasks.
import { all, allSettled, type ParallelOptions, type ParallelResult } from './scheduler';

// =================================================================
// Section 1: MapReduce Pattern
// =================================================================

/**
 * Configuration options for the `mapReduce` utility.
 * @template C The context type for the mapping task.
 * @template TItem The type of individual items in the input data array.
 * @template RMapped The type of results produced by the mapping task for each item.
 * @template UAccumulator The type of the final accumulated/reduced value.
 */
interface MapReduceOptions<C extends BaseContext, TItem, RMapped, UAccumulator> extends ParallelOptions {
  /** The Task to apply to each item in the data array during the map phase. Receives TItem. */
  map: Task<C, TItem, RMapped>;
  /** A synchronous function to reduce the mapped results into a single value. */
  reduce: (accumulator: UAccumulator, currentMappedResult: RMapped, currentIndex: number, allMappedResults: RMapped[]) => UAccumulator;
  /** The initial value for the accumulator in the reduce phase. */
  initial: UAccumulator;
}

/**
 * Performs a parallel map operation over an array of data items, followed by a
 * sequential reduce operation to produce a single summary value.
 *
 * The mapping `Task` (options.map) is applied to each data item. To achieve parallelism
 * with the scheduler, a new set of tasks is created where each task is bound to an
 * individual item from the input `data` array and expects a dummy input (e.g., `null`).
 * These item-specific tasks are then run in parallel using `scheduler.all` or `scheduler.allSettled`.
 *
 * If any mapping task fails, this `mapReduce` task will reject (fail-fast behavior).
 *
 * @template C The context type. Must include `scope` for cancellation.
 * @template TItem The type of items in the input `data` array.
 * @template RMapped The type of results after the map operation for each item.
 * @template UAccumulator The type of the final reduced value.
 * @param data The array of data items to process.
 * @param options Configuration including the `map` Task, `reduce` function,
 *                `initial` accumulator value, and optional `ParallelOptions`.
 * @returns A `Task` that takes no input (null) and resolves to the final reduced value `UAccumulator`.
 */
export function mapReduce<C extends BaseContext, TItem, RMapped, UAccumulator>(
  data: TItem[],
  options: MapReduceOptions<C, TItem, RMapped, UAccumulator>
): Task<C, null, UAccumulator> {
  const { map: mapTaskForItem, reduce: reduceFn, initial, ...parallelOptions } = options;

  const mapReduceOverallTask: Task<C, null, UAccumulator> =
    async (context: C, _: null): Promise<UAccumulator> => {
      if (!data || data.length === 0) {
        // Handle empty data according to reduceFn behavior with initial (or return initial directly)
        // For an empty array, reduce with an initial value returns the initial value.
        const emptyMappedResults: RMapped[] = [];
        return emptyMappedResults.reduce(reduceFn, initial); // Or simply: return initial;
      }

      // 1. Map Phase: Create an array of item-specific tasks.
      // Each task in `itemProcessingTasks` is Task<C, null, RMapped>
      // because `item` is captured in its closure.
      const itemProcessingTasks: Array<Task<C, null, RMapped>> = data.map((item, index) => {
        const itemSpecificMapTask: Task<C, null, RMapped> = (ctx: C, _dmy: null) => mapTaskForItem(ctx, item);
        // Optionally, give these intermediate tasks names for debugging the scheduler
        Object.defineProperty(itemSpecificMapTask, 'name', {
          value: `mapReduceItemTask(${mapTaskForItem.name || 'mapFn'})_idx${index}`,
          configurable: true
        });
        return itemSpecificMapTask;
      });

      // Execute all item-specific mapping tasks in parallel using `scheduler.all`.
      // `scheduler.all` expects Task<C, V, R>[], V (common input), options, context.
      // Here, V is `null` for our `itemProcessingTasks`.
      // `scheduler.all` will reject if any task in `itemProcessingTasks` rejects.
      const mappedResults: RMapped[] = await all<C, null, RMapped>(
        itemProcessingTasks,
        null, // Common dummy input for all itemProcessingTasks
        { ...parallelOptions, preserveOrder: true }, // Ensure order for reduce
        context // Pass overall context for cancellation propagation to scheduler.all
      );

      // 2. Reduce Phase: Sequentially apply the reducer to the mapped results.
      return mappedResults.reduce(reduceFn, initial);
    };

  Object.defineProperty(mapReduceOverallTask, 'name', {
    value: `mapReduce(${mapTaskForItem.name || 'mapTask'}, ${reduceFn.name || 'reduceFn'})`,
    configurable: true,
  });
  Object.defineProperty(mapReduceOverallTask, '__task_id', {
    value: Symbol(`mapReduceTask_${mapTaskForItem.name || 'mapTask'}`),
    configurable: true, enumerable: false, writable: false,
  });

  return mapReduceOverallTask;
}

// =================================================================
// Section 2: Parallel Collection Operations (Filter, GroupBy)
// =================================================================

/**
 * **Pipeable Operator:** Filters an array by applying an asynchronous predicate `Task`
 * to each item in parallel. Items for which the predicate resolves to `true` are
 * included in the result array. The predicate tasks are run using `scheduler.allSettled`
 * to ensure all predicates are evaluated; however, if a predicate task unexpectedly
 * throws an error (other than resolving to false), that error will cause this
 * filter task to reject.
 *
 * @template C The context type. Must include `scope` for cancellation.
 * @template VItem The type of items in the array.
 * @param predicateTask A `Task<C, VItem, boolean>` that takes an item and its context,
 *                      and returns a `Promise<boolean>` indicating if the item should be included.
 * @param options Optional `ParallelOptions` to control concurrency of predicate execution.
 * @returns A `Task<C, VItem[], VItem[]>` that receives an array and resolves to the new, filtered array.
 */
export function filter<C extends BaseContext, VItem>(
  predicateTaskForItem: Task<C, VItem, boolean>,
  options?: ParallelOptions
): Task<C, VItem[], VItem[]> {
  const filterWorkflowTask: Task<C, VItem[], VItem[]> =
    async (context: C, data: VItem[]): Promise<VItem[]> => {
      if (!data || data.length === 0) {
        return [];
      }

      // Create item-specific predicate tasks: Task<C, null, boolean>[]
      const itemPredicateTasks: Array<Task<C, null, boolean>> = data.map((item, index) => {
        const itemSpecificPredicateTask: Task<C, null, boolean> = (ctx: C, _dmy: null) => predicateTaskForItem(ctx, item);
        Object.defineProperty(itemSpecificPredicateTask, 'name', {
          value: `filterItemPredicate(${predicateTaskForItem.name || 'predicateFn'})_idx${index}`,
          configurable: true
        });
        return itemSpecificPredicateTask;
      });

      // Run all predicates in parallel using `scheduler.allSettled` to get boolean results.
      // We use allSettled to ensure we get a boolean result for each item, even if some predicate
      // calls might face operational errors (though ideally a predicate just returns true/false).
      // The `preserveOrder` option is important here.
      const settledBooleanResults: Array<ParallelResult<boolean>> = await allSettled<C, null, boolean>(
        itemPredicateTasks,
        null, // Dummy input
        { ...options, preserveOrder: true }, // Crucial: preserve order to match items
        context
      );

      const filteredData: VItem[] = [];
      for (let i = 0; i < data.length; i++) {
        const result = settledBooleanResults[i];
        if (result.status === 'fulfilled' && result.value === true) {
          filteredData.push(data[i]);
        } else if (result.status === 'rejected') {
          // Decide how to handle predicate errors: re-throw, log, or exclude item?
          // For now, re-throwing to make it visible. Could also log and exclude.
          console.error(`[filter] Predicate for item at index ${i} (value: ${JSON.stringify(data[i])}) rejected with reason:`, result.reason);
          throw new Error(`Predicate error during filter for item at index ${i}: ${result.reason instanceof Error ? result.reason.message : result.reason}`);
        }
        // If status is 'fulfilled' but value is false, item is simply excluded.
      }
      return filteredData;
    };

  Object.defineProperty(filterWorkflowTask, 'name', {
    value: `filter(${predicateTaskForItem.name || 'predicateTask'})`,
    configurable: true,
  });
  Object.defineProperty(filterWorkflowTask, '__task_id', {
    value: Symbol(`filterTask_${predicateTaskForItem.name || 'predicateTask'}`),
    configurable: true, enumerable: false, writable: false,
  });

  return filterWorkflowTask;
}

/**
 * **Pipeable Operator:** Groups items in an array into a `Map` based on a key
 * generated by a `keyingTaskOrFn`. The keying operation for each item is run in parallel
 * using `scheduler.all`. If any keying operation fails, the `groupBy` task will reject.
 *
 * @template C The context type. Must include `scope` for cancellation.
 * @template VItem The type of items in the array.
 * @template KKey The type of the key used for grouping (string, number, or symbol).
 * @param keyingTaskOrFn A `Task<C, VItem, KKey>` or a synchronous function `(item: VItem) => KKey`
 *                       that produces the key for an item. If a synchronous function
 *                       is provided, it will be wrapped into a `Task` using `defineTask`.
 * @param options Optional `ParallelOptions` to control concurrency of key generation.
 * @returns A `Task<C, VItem[], Map<KKey, VItem[]>>` that receives an array and resolves to a `Map`.
 */
export function groupBy<C extends BaseContext, VItem, KKey extends string | number | symbol>(
  keyingTaskOrFn: Task<C, VItem, KKey> | ((item: VItem) => KKey), // Simpler sync fn signature
  options?: ParallelOptions
): Task<C, VItem[], Map<KKey, VItem[]>> {

  const normalizedKeyingTask: Task<C, VItem, KKey> =
    typeof keyingTaskOrFn === 'function' && !(keyingTaskOrFn as Task<C, VItem, KKey>).__task_id
      ? defineTask<VItem, KKey>(async (item: VItem) => { // Global defineTask
        // Plain function is (item: VItem) => KKey. Context is not passed to it here.
        // If context is needed for keying, it must be a Task<C, VItem, KKey>.
        return (keyingTaskOrFn as (item: VItem) => KKey)(item);
      }) as Task<C, VItem, KKey> // Cast from Task<any, VItem, KKey>
      : (keyingTaskOrFn as Task<C, VItem, KKey>);

  const groupByWorkflowTask: Task<C, VItem[], Map<KKey, VItem[]>> =
    async (context: C, data: VItem[]): Promise<Map<KKey, VItem[]>> => {
      if (!data || data.length === 0) {
        return new Map<KKey, VItem[]>();
      }

      // Create item-specific keying tasks: Task<C, null, KKey>[]
      const itemKeyingTasks: Array<Task<C, null, KKey>> = data.map((item, index) => {
        const itemSpecificKeyingTask: Task<C, null, KKey> = (ctx: C, _dmy: null) => normalizedKeyingTask(ctx, item);
        Object.defineProperty(itemSpecificKeyingTask, 'name', {
          value: `groupByItemKeying(${(normalizedKeyingTask as Task<C, VItem, KKey>).name || 'keyFn'})_idx${index}`,
          configurable: true
        });
        return itemSpecificKeyingTask;
      });

      // Execute all keying tasks in parallel. `scheduler.all` will fail fast.
      const keys: KKey[] = await all<C, null, KKey>(
        itemKeyingTasks,
        null, // Dummy input
        { ...options, preserveOrder: true }, // Crucial: preserve order to match items
        context
      );

      const groups = new Map<KKey, VItem[]>();
      for (let i = 0; i < data.length; i++) {
        const key = keys[i];
        const item = data[i];
        const existingGroup = groups.get(key);
        if (existingGroup) {
          existingGroup.push(item);
        } else {
          groups.set(key, [item]);
        }
      }
      return groups;
    };

  Object.defineProperty(groupByWorkflowTask, 'name', {
    value: `groupBy(${(normalizedKeyingTask as Task<C, VItem, KKey>).name || 'keyingTaskOrFn'})`,
    configurable: true,
  });
  Object.defineProperty(groupByWorkflowTask, '__task_id', {
    value: Symbol(`groupByTask_${(normalizedKeyingTask as Task<C, VItem, KKey>).name || 'keyingTaskOrFn'}`),
    configurable: true, enumerable: false, writable: false,
  });

  return groupByWorkflowTask;
}