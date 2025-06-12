/**
 * @module
 * This module provides powerful, high-level utilities for managing structured
 * and parallel control flows. It includes operators for fork-join patterns
 * (fail-fast and settled), conditional branching (if-then-else), and
 * type-safe parallel execution with tuple-based results. These tools enable
 * complex concurrent workflows that remain readable, predictable, and type-safe.
 */

import { type Task, type Scope, type BaseContext } from './run'; // Assuming BaseContext includes Scope
import { type Result, ok, err } from 'neverthrow'; // For settled results

// =================================================================
// Section 1: Fork-Join Patterns
// =================================================================

/**
 * A type-safe, pipeable operator that forks the workflow into multiple
 * parallel tasks and joins their results into a single, keyed object. Each
 * forked task receives the same input value from the parent workflow.
 * If ANY of the tasks reject, the entire `forkJoin` task rejects with the
 * reason of the first rejecting task (fail-fast behavior from `Promise.all`).
 *
 * @param tasks An object where keys are strings and values are `Task`s.
 * @returns A new `Task` that resolves to an object with the same keys,
 *          but with the resolved results of the tasks as values. The output
 *          type is statically inferred from the input object.
 *
 * @example
 * ```typescript
 * const getDashboardData = createWorkflow( // Assuming createWorkflow from your utils
 *   fromValue('user-123'), // The input userId
 *   forkJoin({
 *     user: fetchUser,          // Task<Ctx, string, User>
 *     posts: fetchPosts,        // Task<Ctx, string, Post[]>
 *   }),
 *   // Result: { user: User, posts: Post[] }
 *   map(data => `Welcome ${data.user.name}, you have ${data.posts.length} posts.`)
 * );
 * ```
 */
export function forkJoin<C extends BaseContext, V, T extends Record<string, Task<C, V, any>>>(
  tasks: T
): Task<C, V, { [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }> {
  const forkJoinTask: Task<C, V, { [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }> =
    async (context: C, value: V) => {
      const taskEntries = Object.entries(tasks);
      const taskPromises = taskEntries.map(([_key, taskFn]) => taskFn(context, value));
      const results = await Promise.all(taskPromises);

      const resultObject = {} as { [K in keyof T]: any };
      for (let i = 0; i < taskEntries.length; i++) {
        const key = taskEntries[i][0];
        resultObject[key as keyof T] = results[i];
      }
      return resultObject as { [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never };
    };

  Object.defineProperty(forkJoinTask, 'name', {
    value: `forkJoin(${Object.keys(tasks).join(',') || 'empty'})`,
    configurable: true,
  });
  Object.defineProperty(forkJoinTask, '__task_id', {
    value: Symbol(`forkJoinTask_${Object.keys(tasks).join(',') || 'empty'}`),
    configurable: true, enumerable: false, writable: false
  });

  return forkJoinTask;
}

/**
 * Represents the settled result of a task when using `forkJoinSettled` or `allTupleSettled`.
 * It's either a success with a value or a failure with a reason.
 */
export type SettledTaskResult<R> = Result<R, unknown>; // unknown for error type from Promise.allSettled

/**
 * Similar to `forkJoin`, but uses `Promise.allSettled`. This means it waits for
 * ALL tasks to complete (either resolve or reject) and returns an object
 * where each value is a `SettledTaskResult` (a `Result` type from `neverthrow`
 * indicating success or failure). This task itself will not reject unless
 * there's an unexpected error in its own orchestration logic.
 *
 * @param tasks An object where keys are strings and values are `Task`s.
 * @returns A new `Task` that resolves to an object with the same keys,
 *          where each value is a `SettledTaskResult<R>`.
 *
 * @example
 * ```typescript
 * const getOptionalData = createWorkflow(
 *   fromValue('user-123'),
 *   forkJoinSettled({
 *     profile: fetchUserProfile,    // Might fail
 *     settings: fetchUserSettings,  // Might also fail
 *   }),
 *   map(results => {
 *     const profile = results.profile.isOk() ? results.profile.value : null;
 *     const settings = results.settings.isOk() ? results.settings.value : { darkMode: false };
 *     return { profile, settings };
 *   })
 * );
 * ```
 */
export function forkJoinSettled<C extends BaseContext, V, T extends Record<string, Task<C, V, any>>>(
  tasks: T
): Task<C, V, { [K in keyof T]: T[K] extends Task<C, V, infer R> ? SettledTaskResult<R> : never }> {
  const forkJoinSettledTask: Task<C, V, { [K in keyof T]: T[K] extends Task<C, V, infer R> ? SettledTaskResult<R> : never }> =
    async (context: C, value: V) => {
      const taskEntries = Object.entries(tasks);
      const taskPromises = taskEntries.map(([_key, taskFn]) => taskFn(context, value));

      // Use Promise.allSettled to wait for all promises
      const settledResults = await Promise.allSettled(taskPromises);

      const resultObject = {} as { [K in keyof T]: any };
      for (let i = 0; i < taskEntries.length; i++) {
        const key = taskEntries[i][0];
        const settledResult = settledResults[i];
        if (settledResult.status === 'fulfilled') {
          resultObject[key as keyof T] = ok(settledResult.value);
        } else {
          resultObject[key as keyof T] = err(settledResult.reason);
        }
      }
      return resultObject as { [K in keyof T]: T[K] extends Task<C, V, infer R> ? SettledTaskResult<R> : never };
    };

  Object.defineProperty(forkJoinSettledTask, 'name', {
    value: `forkJoinSettled(${Object.keys(tasks).join(',') || 'empty'})`,
    configurable: true,
  });
  Object.defineProperty(forkJoinSettledTask, '__task_id', {
    value: Symbol(`forkJoinSettledTask_${Object.keys(tasks).join(',') || 'empty'}`),
    configurable: true, enumerable: false, writable: false
  });

  return forkJoinSettledTask;
}


// =================================================================
// Section 2: Tuple-Based Parallel Execution
// =================================================================

/**
 * Runs an array of tasks in parallel and resolves with a tuple containing
 * the results in the same order. This is a type-safe alternative to `forkJoin`
 * when the result keys are not important and the order is fixed and known.
 * If ANY of the tasks reject, the entire `allTuple` task rejects (fail-fast).
 *
 * It is highly recommended to use `as const` on the input array of tasks
 * to ensure TypeScript infers a precise tuple type for the results.
 *
 * @param tasks An array (preferably, a tuple `[...] as const`) of `Task`s.
 * @returns A `Task` that resolves to a tuple of the results, with types preserved.
 *
 * @example
 * ```typescript
 * const setup = allTuple([
 *   connectToDatabase, // -> Task<Ctx, void, DbConnection>
 *   connectToRedis,    // -> Task<Ctx, void, RedisClient>
 * ] as const); // "as const" is key for precise tuple typing
 *
 * // result will be [DbConnection, RedisClient]
 * const [db, redis] = await run(setup, undefined);
 * ```
 */
export function allTuple<C extends BaseContext, V, T extends ReadonlyArray<Task<C, V, any>>>(
  tasks: T
): Task<C, V, { -readonly [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }> {
  const allTupleTask: Task<C, V, { -readonly [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }> =
    async (context: C, value: V) => {
      const taskPromises = tasks.map(taskFn => taskFn(context, value));
      const results = await Promise.all(taskPromises);
      return results as any; // Cast is generally safe due to T being a tuple type
    };

  const taskNames = tasks.map(t => (t as any).name || 'anonTask').join(',');
  Object.defineProperty(allTupleTask, 'name', {
    value: `allTuple(${taskNames || 'empty'})`,
    configurable: true,
  });
  Object.defineProperty(allTupleTask, '__task_id', {
    value: Symbol(`allTupleTask_${taskNames || 'empty'}`),
    configurable: true, enumerable: false, writable: false
  });

  return allTupleTask;
}

/**
 * Similar to `allTuple`, but uses `Promise.allSettled`. It waits for ALL tasks
 * in the input array/tuple to complete and returns a tuple where each element
 * is a `SettledTaskResult` (a `Result` type indicating success or failure).
 * This task itself will not reject unless there's an unexpected error in its
 * own orchestration logic. Use `as const` for precise output tuple typing.
 *
 * @param tasks An array (preferably, a tuple `[...] as const`) of `Task`s.
 * @returns A `Task` that resolves to a tuple of `SettledTaskResult<R>`.
 *
 * @example
 * ```typescript
 * const [dbResult, redisResult] = await run(
 *   allTupleSettled([connectToDb, connectToRedis] as const),
 *   undefined
 * );
 *
 * if (dbResult.isOk()) { /* use dbResult.value *\/ }
 * if (redisResult.isErr()) { /* handle redis error: redisResult.error *\/ }
 * ```
 */
export function allTupleSettled<C extends BaseContext, V, T extends ReadonlyArray<Task<C, V, any>>>(
  tasks: T
): Task<C, V, { -readonly [K in keyof T]: T[K] extends Task<C, V, infer R> ? SettledTaskResult<R> : never }> {
  const allTupleSettledTask: Task<C, V, { -readonly [K in keyof T]: T[K] extends Task<C, V, infer R> ? SettledTaskResult<R> : never }> =
    async (context: C, value: V) => {
      const taskPromises = tasks.map(taskFn => taskFn(context, value));
      const settledResults = await Promise.allSettled(taskPromises);

      const resultsTuple = settledResults.map(res =>
        res.status === 'fulfilled' ? ok(res.value) : err(res.reason)
      );
      return resultsTuple as any; // Cast is generally safe for tuple output
    };

  const taskNames = tasks.map(t => (t as any).name || 'anonTask').join(',');
  Object.defineProperty(allTupleSettledTask, 'name', {
    value: `allTupleSettled(${taskNames || 'empty'})`,
    configurable: true,
  });
  Object.defineProperty(allTupleSettledTask, '__task_id', {
    value: Symbol(`allTupleSettledTask_${taskNames || 'empty'}`),
    configurable: true, enumerable: false, writable: false
  });

  return allTupleSettledTask;
}


// =================================================================
// Section 3: Conditional Branching
// =================================================================

/**
 * A pipeable operator that provides true conditional branching (if-then-else)
 * for workflows. It evaluates a predicate (which can be synchronous or asynchronous)
 * and executes one of two provided `Task`s based on the boolean result.
 * Both the `onTrue` and `onFalse` tasks receive the same input value that `ift` received.
 *
 * @param predicate A sync or async function that receives the current value and context,
 *                  and returns a boolean (`true` or `false`) to determine which path to take.
 * @param onTrue The `Task` to execute if the predicate returns `true`.
 * @param onFalse The `Task` to execute if the predicate returns `false`.
 * @returns A new `Task` whose result type is a union of the result types
 *          of the `onTrue` and `onFalse` tasks, reflecting the two possible outcomes.
 *
 * @example
 * ```typescript
 * const processPayment = createWorkflow( // Assuming createWorkflow from your utils
 *   createOrder,
 *   ift(
 *     async (order, ctx) => await ctx.fraudCheck.isSafe(order), // Async predicate
 *     chargeCreditCard,  // Task<Ctx, Order, ChargeSuccess>
 *     holdForReview      // Task<Ctx, Order, HoldResult>
 *   )
 *   // Result type is ChargeSuccess | HoldResult
 * );
 * ```
 */
export function ift<C extends BaseContext, V, R1, R2>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  onTrue: Task<C, V, R1>,
  onFalse: Task<C, V, R2>
): Task<C, V, R1 | R2> {
  const iftTask: Task<C, V, R1 | R2> = async (context: C, value: V) => {
    // Await the predicate (works for both sync boolean and Promise<boolean>)
    if (await predicate(value, context)) {
      return onTrue(context, value);
    } else {
      return onFalse(context, value);
    }
  };

  Object.defineProperty(iftTask, 'name', {
    value: `ift(${predicate.name || 'anonPredicate'} ? ${onTrue.name || 'anonTrue'} : ${onFalse.name || 'anonFalse'})`,
    configurable: true,
  });
  Object.defineProperty(iftTask, '__task_id', {
    value: Symbol(`iftTask_${predicate.name || 'anonPredicate'}`),
    configurable: true, enumerable: false, writable: false
  });

  return iftTask;
}