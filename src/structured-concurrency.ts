/**
 * @module
 * This module provides powerful, high-level utilities for managing structured
 * and parallel control flows. It includes operators for fork-join patterns,
 * conditional branching (if-then-else), and type-safe parallel execution
 * with tuple-based results. These tools enable complex concurrent workflows
 * that remain readable, predictable, and type-safe.
 */

import { defineTask, getContext, type Task, type Scope } from './run';
import { all } from './scheduler';

/**
 * A type-safe, pipeable operator that forks the workflow into multiple
 * parallel tasks and joins their results into a single, keyed object. Each
 * forked task receives the same input value from the parent workflow. This
 * is the ideal tool for orchestrating parallel, independent data fetches.
 *
 * @param tasks An object where keys are strings and values are `Task`s.
 * @returns A new `Task` that resolves to an object with the same keys,
 *          but with the resolved results of the tasks as values. The output
 *          type is statically inferred from the input object, ensuring
 *          complete type safety.
 *
 * @example
 * ```typescript
 * const getDashboardData = pipe(
 *   fromValue('user-123'), // The input userId
 *   forkJoin({
 *     user: fetchUser,          // Task<any, string, User>
 *     posts: fetchPosts,        // Task<any, string, Post[]>
 *     permissions: fetchPermissions, // Task<any, string, string[]>
 *   }),
 *   // The result is a typed object: { user: User, posts: Post[], permissions: string[] }
 *   map(data => `Welcome ${data.user.name}, you have ${data.posts.length} posts.`)
 * );
 *
 * const message = await run(getDashboardData);
 * ```
 */
export function forkJoin<C extends { scope: Scope }, V, T extends Record<string, Task<C, V, any>>>(
  tasks: T
): Task<C, V, { [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }> {
  return async (context: C, value: V) => {
    const taskEntries = Object.entries(tasks);

    // Create an array of zero-argument executable tasks. Each new task's closure
    // captures the specific `task`, the shared `context`, and the `value`.
    // This prepares them to be run by the `all` scheduler utility.
    const executableTasks = taskEntries.map(
      ([_key, task]) => async () => task(context, value)
    );

    // Use the `all` utility to run all tasks in parallel.
    // The `null` input is appropriate because the values are already baked into the tasks' closures.
    const results = await all(executableTasks, null, undefined, context);

    // Reconstruct the result object, mapping parallel results back to their original keys.
    const resultObject = {} as { [K in keyof T]: any };
    for (let i = 0; i < taskEntries.length; i++) {
      const key = taskEntries[i][0];
      resultObject[key as keyof T] = results[i];
    }

    return resultObject as { [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }
  };
}

/**
 * A pipeable operator that provides true conditional branching (if-then-else)
 * for workflows. It evaluates a predicate and executes one of two provided
 * `Task`s based on the boolean result.
 *
 * @param predicate A sync or async function that receives the current value and context,
 *                  and returns a boolean to determine which path to take.
 * @param onTrue The `Task` to execute if the predicate returns `true`.
 * @param onFalse The `Task` to execute if the predicate returns `false`.
 * @returns A new `Task` whose result type is a union of the result types
 *          of the `onTrue` and `onFalse` tasks, reflecting the two possible outcomes.
 *
 * @example
 * ```typescript
 * const processPayment = pipe(
 *   createOrder,
 *   ift(
 *     (order, ctx) => ctx.fraudCheck.isSafe(order),
 *     chargeCreditCard,  // onTrue task
 *     holdForReview      // onFalse task
 *   )
 * );
 * ```
 */
export function ift<C extends { scope: Scope }, V, R1, R2>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  onTrue: Task<C, V, R1>,
  onFalse: Task<C, V, R2>
): Task<C, V, R1 | R2> {
  return async (context: C, value: V) => {
    // Await the predicate and then execute the appropriate task, passing it
    // the necessary context and value.
    if (await predicate(value, context)) {
      return onTrue(context, value);
    } else {
      return onFalse(context, value);
    }
  };
}

/**
 * Runs an array of tasks in parallel and resolves with a tuple containing
 * the results in the same order. This is a type-safe alternative to `forkJoin`
 * when the result keys are not important and the order is fixed and known.
 * It is especially powerful for type-safe destructuring of results.
 *
 * @param tasks An array (or preferably, a tuple `[...] as const`) of `Task`s.
 * @returns A `Task` that resolves to a tuple of the results, with types preserved.
 *
 * @example
 * ```typescript
 * const setup = allTuple([
 *   connectToDatabase, // -> DbConnection
 *   connectToRedis,    // -> RedisClient
 * ] as const);
 *
 * const [db, redis] = await run(setup); // Types are correctly inferred!
 * ```
 */
export function allTuple<C extends { scope: Scope }, V, T extends ReadonlyArray<Task<C, V, any>>>(
  tasks: T
): Task<C, V, { -readonly [K in keyof T]: T[K] extends Task<C, V, infer R> ? R : never }> {
  // The implementation logic is nearly identical to forkJoin, but for arrays.
  return async (context: C, value: V) => {
    const executableTasks = tasks.map(
      (task) => async () => task(context, value)
    );
    const results = await all(executableTasks, null, undefined, context);
    // The result from `all` is `any[]`, but we can safely cast it to the
    // more specific tuple type inferred by TypeScript.
    return results as any;
  };
}