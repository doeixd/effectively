/**
 * @module do-notation
 * 
 * Monadic do notation using generator syntax for cleaner async composition.
 * Inspired by Haskell's do notation, this module provides a way to chain
 * monadic operations in a more readable, imperative style while maintaining
 * functional purity.
 */

import type { BaseContext, Task } from './run';
import type { Result } from 'neverthrow';

/**
 * A monadic value that can be yielded in a do block.
 * This represents any value that can be "unwrapped" in monadic composition.
 */
export type MonadicValue<C extends BaseContext, T> = 
  | Task<C, any, T>
  | Promise<T>
  | Result<T, any>
  | T;

/**
 * Utility type to extract the inner type from a MonadicValue.
 */
export type Unwrap<T> = 
  T extends Task<any, any, infer R> ? R :
  T extends Promise<infer R> ? R :
  T extends Result<infer R, any> ? R :
  T;

/**
 * Generator function type for do notation.
 * Each yield should be a MonadicValue that gets unwrapped.
 */
export type DoGenerator<C extends BaseContext, T> = Generator<MonadicValue<C, any>, T, any>;

/**
 * Function signature for do block generators.
 */
export type DoFunction<C extends BaseContext, V, R> = (value: V) => DoGenerator<C, R>;

/**
 * Executes a generator-based do block, unwrapping each yielded monadic value.
 * This provides Haskell-like do notation for JavaScript/TypeScript.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* (userId: string) {
 *   const user = yield getUser(userId);        // Task<Context, string, User>
 *   const profile = yield getProfile(user.id); // Task<Context, string, Profile>
 *   const settings = yield getSettings(user.id); // Task<Context, string, Settings>
 *   
 *   return {
 *     user,
 *     profile,
 *     settings
 *   };
 * });
 * ```
 * 
 * @param generator A generator function that yields monadic values
 * @returns A Task that executes the generator and unwraps yielded values
 */
export function doTask<C extends BaseContext, V, R>(
  generator: DoFunction<C, V, R>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const gen = generator(value);
    let result = gen.next();

    while (!result.done) {
      const yieldedValue = result.value;
      let unwrappedValue: any;

      try {
        unwrappedValue = await unwrapMonadicValue(context, yieldedValue);
      } catch (error) {
        // Send the error to the generator via throw()
        result = gen.throw(error);
        continue;
      }

      result = gen.next(unwrappedValue);
    }

    return result.value;
  };
}

/**
 * Unwraps a monadic value based on its type.
 * Handles Tasks, Promises, Results, and plain values.
 */
async function unwrapMonadicValue<C extends BaseContext>(
  context: C, 
  value: MonadicValue<C, any>
): Promise<any> {
  // Handle Task - check if it has __task_id property
  if (typeof value === 'function' && ('__task_id' in value || value.length === 2)) {
    // Task functions take (context, input) - we pass undefined as input for parameterless tasks
    return (value as Task<C, any, any>)(context, undefined);
  }
  
  // Handle Promise
  if (value && typeof value === 'object' && 'then' in value) {
    return value;
  }
  
  // Handle Result type (neverthrow)
  if (value && typeof value === 'object' && 'isOk' in value && 'isErr' in value) {
    const result = value as Result<any, any>;
    if (result.isOk()) {
      return result.value;
    } else {
      throw result.error;
    }
  }
  
  // Handle plain values
  return value;
}

/**
 * Creates a do notation wrapper for a specific context type.
 * This allows for better type inference and context handling.
 * 
 * @example
 * ```typescript
 * interface MyContext extends BaseContext {
 *   db: Database;
 *   logger: Logger;
 * }
 * 
 * const { doTask: myDoTask } = createDoNotation<MyContext>();
 * 
 * const workflow = myDoTask(function* (userId: string) {
 *   const user = yield getUser(userId);
 *   const posts = yield getPosts(user.id);
 *   return { user, posts };
 * });
 * ```
 * 
 * @returns An object with context-specific do notation functions
 */
export function createDoNotation<C extends BaseContext>() {
  return {
    doTask: <V, R>(generator: DoFunction<C, V, R>): Task<C, V, R> => 
      doTask<C, V, R>(generator),
      
    /**
     * Convenience function for creating simple do blocks that don't need input.
     */
    doBlock: <R>(generator: () => DoGenerator<C, R>): Task<C, void, R> => 
      doTask<C, void, R>(() => generator()),
  };
}

/**
 * Utility function to lift a regular value into the monadic context.
 * Useful for returning plain values from within do blocks.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* () {
 *   const x = yield getValue();
 *   const y = yield pure(42); // Lifts 42 into the monadic context
 *   return x + y;
 * });
 * ```
 */
export function pure<T>(value: T): T {
  return value;
}

/**
 * Helper function to call a task with a specific input value.
 * This allows you to use tasks that require input parameters in do notation.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* () {
 *   const user = yield call(getUserById, 'user123');
 *   const profile = yield call(getProfile, user.id);
 *   return { user, profile };
 * });
 * ```
 */
export function call<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  input: V
): Task<C, void, R> {
  return async (context: C, _value: void): Promise<R> => {
    return task(context, input);
  };
}

/**
 * Conditional monadic execution.
 * Executes one of two monadic values based on a condition.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* (userId: string) {
 *   const user = yield getUser(userId);
 *   const data = yield doWhen(
 *     user.isAdmin,
 *     () => getAdminData(userId),
 *     () => getUserData(userId)
 *   );
 *   return data;
 * });
 * ```
 */
export function doWhen<C extends BaseContext, T>(
  condition: boolean,
  onTrue: () => MonadicValue<C, T>,
  onFalse: () => MonadicValue<C, T>
): MonadicValue<C, T> {
  return condition ? onTrue() : onFalse();
}

/**
 * Maybe-like conditional execution.
 * Only executes the monadic value if the condition is true.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* (userId: string) {
 *   const user = yield getUser(userId);
 *   yield doUnless(user.isActive, () => activateUser(userId));
 *   return user;
 * });
 * ```
 */
export function doUnless<C extends BaseContext, T = void>(
  condition: boolean,
  action: () => MonadicValue<C, T>
): MonadicValue<C, T | void> {
  return condition ? pure(undefined) : action();
}

/**
 * Executes multiple monadic values in sequence and collects their results.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* (userIds: string[]) {
 *   const users = yield sequence(userIds.map(id => getUser(id)));
 *   return users;
 * });
 * ```
 */
export function sequence<C extends BaseContext, T>(
  values: MonadicValue<C, T>[]
): Task<C, void, T[]> {
  return async (context: C, _value: void): Promise<T[]> => {
    const results: T[] = [];
    for (const value of values) {
      const result = await unwrapMonadicValue(context, value);
      results.push(result);
    }
    return results;
  };
}

/**
 * Loops over an array, executing a monadic function for each element.
 * 
 * @example
 * ```typescript
 * const workflow = doTask(function* (userIds: string[]) {
 *   yield forEach(userIds, function* (userId) {
 *     const user = yield getUser(userId);
 *     yield logUser(user);
 *   });
 * });
 * ```
 */
export function forEach<C extends BaseContext, T>(
  items: T[],
  action: (item: T) => DoGenerator<C, void>
): Task<C, void, void> {
  return async (context: C, _value: void): Promise<void> => {
    for (const item of items) {
      const gen = action(item);
      let result = gen.next();

      while (!result.done) {
        const yieldedValue = result.value;
        try {
          const unwrappedValue = await unwrapMonadicValue(context, yieldedValue);
          result = gen.next(unwrappedValue);
        } catch (error) {
          result = gen.throw(error);
        }
      }
    }
  };
}
