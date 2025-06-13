/**
 * @module TaskEnhancerUtils
 * This module provides utilities for creating and composing `TaskEnhancer` functions.
 * Task enhancers are higher-order functions that take a `Task` and return a new,
 * "enhanced" `Task`, often adding behavior like logging, retries, caching, or
 * modifying its context or error handling.
 *
 * - `finalizeEnhancedTask`: A helper for authors of specific enhancers (e.g., `withRetry`, `withTimeout`)
 *   to consistently apply metadata like `name`, `__task_id`, and `__steps` to the enhanced task.
 * - `createTaskEnhancer`: A factory function to simplify the creation of new enhancers by abstracting
 *   the metadata application based on configurable options.
 * - `composeEnhancers`: A utility to compose multiple `TaskEnhancer` functions into a single,
 *   more powerful enhancer, applying them in a specified order.
 */

import { type Task, type BaseContext } from './run';

// =================================================================
// Section 1: Finalizing Enhanced Tasks (Metadata Application)
// =================================================================

/**
 * Options to control how metadata is applied to an enhanced task by `finalizeEnhancedTask`.
 */
export interface EnhancerMetaOptions {
  /** 
   * The specific name for the enhanced task. This will be set as `enhancedTask.name`.
   * It's recommended to include the original task's name and the nature of the enhancement.
   * Example: `withRetry(originalTaskName, 3_attempts)`
   */
  name: string;
  /** 
   * Determines how the `__task_id` property is handled for the enhanced task.
   * - `'propagate'` (default): If the original task has a `__task_id`, it's copied to the enhanced task.
   * - `'new'`: A new, unique Symbol (using `meta.name` as description) is created for the enhanced task's `__task_id`.
   *            This is useful if the enhancer creates a distinct logical step that could be a backtrack target.
   * - `'none'`: No `__task_id` is set on the enhanced task, even if the original had one.
   * @default 'propagate'
   */
  taskIdAction?: 'propagate' | 'new' | 'none';
  /** 
   * Determines how the `__steps` property (if the original task was a workflow) is handled.
   * - `'propagate'` (default): If the original task has `__steps`, it's copied to the enhanced task.
   * - `'none'`: No `__steps` property is set on the enhanced task.
   * @default 'propagate'
   */
  stepsAction?: 'propagate' | 'none';
}

/**
 * A utility function for enhancer authors to consistently apply standard metadata
 * (like `name`, `__task_id`, `__steps`) to an already created enhanced task logic.
 *
 * This function takes the original task (for sourcing properties like `__task_id`),
 * the new async function that embodies the enhancer's logic (`enhancedTaskLogic`),
 * and metadata options, then returns the `enhancedTaskLogic` with properties attached.
 *
 * @template C The context type.
 * @template V The input value type.
 * @template R The result type.
 * @param originalTask The original `Task` that was enhanced. Used to source properties for propagation.
 * @param enhancedTaskLogic The new `Task` function (the core logic of the enhancer)
 *                          to which metadata will be applied.
 * @param meta Metadata options specifying the name and how to handle `__task_id` and `__steps`.
 * @returns The `enhancedTaskLogic` function, now with metadata properties defined on it.
 *
 * @example
 * ```typescript
 * // Inside an enhancer like `withMyCustomFeature`
 * const myEnhancerLogic = async (context, value) => { ... };
 * return finalizeEnhancedTask(originalTask, myEnhancerLogic, {
 *   name: `withMyCustomFeature(${originalTask.name})`,
 *   taskIdAction: 'new', // This feature is a new distinct step
 * });
 * ```
 */
export function finalizeEnhancedTask<C extends BaseContext, V, R>(
  originalTask: Task<C, V, R>,
  enhancedTaskLogic: Task<C, V, R>,
  meta: EnhancerMetaOptions
): Task<C, V, R> {
  // Set the human-readable name for the enhanced task.
  Object.defineProperty(enhancedTaskLogic, 'name', {
    value: meta.name,
    configurable: true, // Allows it to be changed again if further enhanced
    writable: false,    // Name should generally not be writable after set
    enumerable: false,  // Standard for function names
  });

  // Determine and apply __task_id based on the specified action.
  const taskIdAction = meta.taskIdAction ?? 'propagate';
  const originalTaskId = (originalTask as Task<C, V, R> & { __task_id?: symbol }).__task_id;

  if (taskIdAction === 'propagate' && originalTaskId) {
    Object.defineProperty(enhancedTaskLogic, '__task_id', {
      value: originalTaskId,
      configurable: true, enumerable: false, writable: false,
    });
  } else if (taskIdAction === 'new') {
    Object.defineProperty(enhancedTaskLogic, '__task_id', {
      value: Symbol(meta.name), // Use the enhancer's specific name for the Symbol description
      configurable: true, enumerable: false, writable: false,
    });
  }
  // If 'none', nothing is done for __task_id.

  // Determine and apply __steps based on the specified action.
  const stepsAction = meta.stepsAction ?? 'propagate';
  const originalSteps = (originalTask as Task<C, V, R> & { __steps?: ReadonlyArray<Task<C, unknown, unknown>> }).__steps;

  if (stepsAction === 'propagate' && originalSteps) {
    Object.defineProperty(enhancedTaskLogic, '__steps', {
      value: originalSteps, // Propagate the original steps array
      configurable: true, enumerable: false, writable: false,
    });
  }
  // If 'none', nothing is done for __steps.

  return enhancedTaskLogic;
}

// =================================================================
// Section 2: Creating Task Enhancers (Factory Pattern)
// =================================================================

/**
 * Configuration options for the `createTaskEnhancer` factory.
 * These options control how metadata is automatically applied to tasks
 * created by the enhancer logic.
 */
interface CreateEnhancerOptions {
  /** 
   * A function to generate the name for the enhanced task. 
   * It receives the original task's name (or 'anonymousTask') and any arguments
   * that were passed to the enhancer factory when the enhancer was generated.
   * 
   * @param originalTaskName The name of the task being enhanced.
   * @param factoryArgs The arguments passed to the function returned by `createTaskEnhancer`.
   * @returns The desired name for the enhanced task.
   */
  nameFn?: (originalTaskName: string, ...factoryArgs: any[]) => string;
  /** 
   * Policy for handling the `__task_id` property.
   * @see EnhancerMetaOptions['taskIdAction']
   * @default 'propagate'
   */
  taskIdAction?: 'propagate' | 'new' | 'none';
  /** 
   * Policy for handling the `__steps` property.
   * @see EnhancerMetaOptions['stepsAction']
   * @default 'propagate'
   */
  stepsAction?: 'propagate' | 'none';
}

/**
 * Represents a function that enhances a Task. It's the core piece returned by
 * an enhancer factory (the function returned by `createTaskEnhancer`).
 * @template C The context type.
 * @template V The input value type.
 * @template R The result type.
 */
export type TaskEnhancer<C extends BaseContext, V, R> = (task: Task<C, V, R>) => Task<C, V, R>;


/**
 * A higher-order function (factory) to simplify the creation of new `TaskEnhancer`s.
 * You provide a factory function (`enhancerLogicFactory`) that defines the core
 * transformation logic for a task. `createTaskEnhancer` then wraps this logic,
 * automatically handling the application of metadata (name, `__task_id`, `__steps`)
 * to the resulting enhanced task based on the provided `options`.
 *
 * This promotes consistency in how enhancers are defined and how they interact
 * with task metadata crucial for debugging and internal mechanisms like backtracking.
 *
 * @template C The context type of the tasks being enhanced.
 * @template V The input value type of the tasks.
 * @template R The result type of the tasks.
 * @template FactoryArgs An array type representing the arguments accepted by the
 *                       enhancer factory itself (e.g., `durationMs` for `withTimeout`,
 *                       `RetryOptions` for `withRetry`).
 *
 * @param enhancerLogicFactory A function that accepts `FactoryArgs` and returns
 *                             the actual enhancer function. This enhancer function
 *                             (`(originalTask: Task<C,V,R>) => Task<C,V,R>`) contains
 *                             the core logic of the enhancement (e.g., wrapping the
 *                             original task in a try-catch, adding retry logic, etc.).
 *                             The task returned by this inner function should be the raw
 *                             enhanced logic, before metadata is applied.
 * @param options Optional configuration for how metadata should be generated and propagated.
 * @returns A new function. When this function is called with `FactoryArgs`, it produces
 *          a fully-formed `TaskEnhancer<C,V,R>` that can be applied to a task.
 *
 * @example
 * ```typescript
 * // Defining a hypothetical `withLogging` enhancer using `createTaskEnhancer`
 * const withLogging = createTaskEnhancer(
 *   // This is the enhancerLogicFactory. It takes a prefix string (our FactoryArgs).
 *   (prefix: string) =>
 *     // It returns the actual enhancer function.
 *     (originalTask: Task<BaseContext, any, any>) =>
 *       // This is the enhanced task logic.
 *       async (context, value) => {
 *         const logger = (context as any).logger || console;
 *         logger.log(`${prefix}: Before '${originalTask.name || 'anonymous'}'`);
 *         try {
 *           const result = await originalTask(context, value);
 *           logger.log(`${prefix}: After '${originalTask.name || 'anonymous'}'`);
 *           return result;
 *         } catch (e) {
 *           logger.error(`${prefix}: Error in '${originalTask.name || 'anonymous'}':`, e);
 *           throw e;
 *         }
 *       },
 *   // Options for createTaskEnhancer:
 *   {
 *     nameFn: (originalName, prefixArg) => `${prefixArg}(${originalName})`, // Name like "DEBUG:(myTask)"
 *     taskIdAction: 'propagate', // Keep original task's ID if it exists
 *   }
 * );
 *
 * // Using the created enhancer factory:
 * const debugLogEnhancer = withLogging("DEBUG"); // Returns a TaskEnhancer
 * const myTask = defineTask(async (ctx, data: string) => data.toUpperCase());
 * const loggedTask = debugLogEnhancer(myTask); // Apply the enhancer
 *
 * // const result = await run(loggedTask, "hello");
 * ```
 */
export function createTaskEnhancer<
  C extends BaseContext, V, R,
  FactoryArgs extends any[] = []
>(
  // enhancerLogicFactory takes some args (e.g. durationMs for withTimeout)
  // and returns the function that actually takes originalTask and returns enhancedTaskLogic
  enhancerLogicFactory: (...factoryArgs: FactoryArgs) => (originalTask: Task<C, V, R>) => Task<C, V, R>,
  options?: CreateEnhancerOptions
): (...factoryArgs: FactoryArgs) => TaskEnhancer<C, V, R> {

  // This outer function is the enhancer factory, it takes arguments like durationMs or retryOptions.
  return (...factoryArgs: FactoryArgs): TaskEnhancer<C, V, R> => {
    // Get the core enhancer logic function by calling the factory with its specific arguments.
    const coreEnhancerFunction = enhancerLogicFactory(...factoryArgs);

    // This is the actual TaskEnhancer that will be returned and applied to a task.
    return (originalTask: Task<C, V, R>): Task<C, V, R> => {
      // Apply the core logic to get the un-decorated enhanced task function.
      const enhancedTaskLogic = coreEnhancerFunction(originalTask);

      // Determine the name for the enhanced task.
      const originalTaskName = (originalTask as Task<C, V, R> & { name?: string }).name || 'anonymousTask';
      const finalName = options?.nameFn
        ? options.nameFn(originalTaskName, ...factoryArgs) // Pass factoryArgs to nameFn
        : `enhanced(${originalTaskName})`; // Default naming scheme

      // Use finalizeEnhancedTask to apply metadata.
      return finalizeEnhancedTask(originalTask, enhancedTaskLogic, {
        name: finalName,
        taskIdAction: options?.taskIdAction ?? 'propagate',
        stepsAction: options?.stepsAction ?? 'propagate',
      });
    };
  };
}


// =================================================================
// Section 3: Composing Task Enhancers
// =================================================================

// TaskEnhancer type is defined above in Section 2.

// Overloads for type-safe composition up to a common number of enhancers.
// These ensure that all enhancers in a composition operate on compatible Task signatures.
export function composeEnhancers<C extends BaseContext, V, R>(
  e1: TaskEnhancer<C, V, R>
): TaskEnhancer<C, V, R>;
export function composeEnhancers<C extends BaseContext, V, R>(
  e1: TaskEnhancer<C, V, R>,
  e2: TaskEnhancer<C, V, R>
): TaskEnhancer<C, V, R>;
export function composeEnhancers<C extends BaseContext, V, R>(
  e1: TaskEnhancer<C, V, R>,
  e2: TaskEnhancer<C, V, R>,
  e3: TaskEnhancer<C, V, R>
): TaskEnhancer<C, V, R>;
export function composeEnhancers<C extends BaseContext, V, R>(
  e1: TaskEnhancer<C, V, R>,
  e2: TaskEnhancer<C, V, R>,
  e3: TaskEnhancer<C, V, R>,
  e4: TaskEnhancer<C, V, R>
): TaskEnhancer<C, V, R>;
export function composeEnhancers<C extends BaseContext, V, R>(
  e1: TaskEnhancer<C, V, R>,
  e2: TaskEnhancer<C, V, R>,
  e3: TaskEnhancer<C, V, R>,
  e4: TaskEnhancer<C, V, R>,
  e5: TaskEnhancer<C, V, R>
): TaskEnhancer<C, V, R>;
// Add more overloads if commonly composing more than 5 enhancers.

/**
 * Composes multiple `TaskEnhancer` functions into a single `TaskEnhancer`.
 * The enhancers are applied from right to left, following standard functional
 * composition (e.g., `(f o g o h)(x) = f(g(h(x)))`).
 * This means the last enhancer in the argument list is applied first (innermost),
 * and the first enhancer is applied last (outermost).
 *
 * @template C The context type of the Tasks.
 * @template V The input value type of the Tasks.
 * @template R The result type of the Tasks.
 * @param {...TaskEnhancer<C, V, R>[]} enhancers A sequence of `TaskEnhancer` functions to compose.
 * @returns A new `TaskEnhancer` that applies all given enhancers in sequence.
 *          If no enhancers are provided, it returns an identity enhancer (task => task).
 *
 * @example
 * ```typescript
 * const myTask = defineTask(async (ctx, data: string) => data);
 * const addRetry = (task: Task<any,any,any>) => withRetry(task, { attempts: 3 });
 * const addTimeout = (task: Task<any,any,any>) => withTimeout(task, 1000);
 *
 * const composedEnhancer = composeEnhancers(addTimeout, addRetry);
 * // Equivalent to: task => addTimeout(addRetry(task))
 * // So, addRetry wraps myTask first, then addTimeout wraps that result.
 *
 * const resilientTask = composedEnhancer(myTask);
 * ```
 */
export function composeEnhancers<C extends BaseContext, V, R>(
  ...enhancers: Array<TaskEnhancer<C, V, R>> // Ensure it's an array
): TaskEnhancer<C, V, R> {
  // If no enhancers are provided, return an identity function.
  if (enhancers.length === 0) {
    return (task: Task<C, V, R>) => task;
  }
  // If only one enhancer, return it directly.
  if (enhancers.length === 1) {
    return enhancers[0];
  }
  return enhancers.reduce((a, b) => (task) => a(b(task)));
}