/**
 * @module
 * This module provides a comprehensive suite of utility functions for creating,
 * composing, and enhancing Tasks. These tools enable powerful, declarative
 * workflows with built-in support for flow control, data transformation,
 * error handling, and resource management.
 *
 * The primary method of composition is the `pipe` function, which allows for
 * creating clean, readable, and type-safe chains of operations.
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
} from './run'; // Assuming core types are in './run'

// A lightweight deep-equal implementation for memoize key comparison
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

// =================================================================
// Section 1: Core Composition (`createWorkflow` and Starters)
// =================================================================

/**
 * Pipes a value through a sequence of functions, from left to right.
 *
 * It takes an initial value and applies each function to the result of the
 * previous one. This is a common pattern in functional programming for creating
 * a data processing pipeline.
 *
 * @param value The initial value to pass into the pipeline.
 * @param fns A sequence of functions to apply in order. Each function must
 *   take the output of the previous function as its input.
 * @returns The final result after all functions have been applied.
 *
 * @example
 * ```typescript
 * const result = pipe(
 *   "  hello world  ",
 *   (s) => s.trim(),
 *   (s) => s.toUpperCase(),
 *   (s) => s.split(' ')
 * ); // result is ["HELLO", "WORLD"]
 *
 * const initialScore = 50;
 * const newScore = pipe(
 *   initialScore,
 *   (score) => score + 10,
 *   (score) => score * 2
 * ); // newScore is 120
 * ```
 */
export function pipe<A>(value: A): A;
export function pipe<A, B>(value: A, f1: (a: A) => B): B;
export function pipe<A, B, C>(value: A, f1: (a: A) => B, f2: (b: B) => C): C;
export function pipe<A, B, C, D>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D): D;
export function pipe<A, B, C, D, E>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E): E;
export function pipe<A, B, C, D, E, F>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F): F;
export function pipe<A, B, C, D, E, F, G>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G): G;
export function pipe<A, B, C, D, E, F, G, H>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H): H;
export function pipe<A, B, C, D, E, F, G, H, I>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(value: A, f1: (a: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I, f9: (i: I) => J): J;
export function pipe(value: any, ...fns: Function[]): any {
  let currentValue = value;
  for (const fn of fns) {
    currentValue = fn(currentValue);
  }
  return currentValue;
}

/**
 * Composes a sequence of functions from left to right, creating a new function.
 *
 * It's like `pipe`, but it doesn't take an initial value. Instead, it returns a
 * new function that, when called, will run the composed logic. This is useful
 * for creating reusable, complex functions from smaller, single-purpose ones.
 * The first function can take any number of arguments; the subsequent functions
 * must be unary (take a single argument).
 *
 * @param fns A sequence of functions to compose.
 * @returns A new function that takes the input of the first function and
 *          returns the output of the last function.
 *
 * @example
 * ```typescript
 * const processString = flow(
 *   (s: string) => s.trim(),
 *   (s) => s.toUpperCase(),
 *   (s) => s.replace(" ", "_")
 * );
 *
 * const result = processString("  hello world  "); // "HELLO_WORLD"
 * ```
 */
// Overloads are essential for TypeScript's type inference to work correctly.
export function flow<A extends any[], B>(f1: (...args: A) => B): (...args: A) => B;
export function flow<A extends any[], B, C>(f1: (...args: A) => B, f2: (b: B) => C): (...args: A) => C;
export function flow<A extends any[], B, C, D>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D): (...args: A) => D;
export function flow<A extends any[], B, C, D, E>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E): (...args: A) => E;
export function flow<A extends any[], B, C, D, E, F>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F): (...args: A) => F;
export function flow<A extends any[], B, C, D, E, F, G>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G): (...args: A) => G;
export function flow<A extends any[], B, C, D, E, F, G, H>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H): (...args: A) => H;
export function flow<A extends any[], B, C, D, E, F, G, H, I>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I): (...args: A) => I;
export function flow<A extends any[], B, C, D, E, F, G, H, I, J>(f1: (...args: A) => B, f2: (b: B) => C, f3: (c: C) => D, f4: (d: D) => E, f5: (e: E) => F, f6: (f: F) => G, f7: (g: G) => H, f8: (h: H) => I, f9: (i: I) => J): (...args: A) => J;
export function flow(...fns: Function[]): Function {
  const { length } = fns;
  if (length === 0) {
    return <T>(arg: T): T => arg;
  }

  if (length === 1) {
    return fns[0];
  }

  return (...args: any[]): any => {
    let currentValue = fns[0](...args);

    for (let i = 1; i < length; i++) {
      currentValue = fns[i](currentValue);
    }

    return currentValue;
  };
}


/**
 * Chains multiple tasks together into a single, sequential workflow.
 * The output of each task is passed as the input to the next. This is the
 * primary composition utility for the library. Plain functions can be used
 * as steps and will be automatically wrapped in a `Task`.
 *
 * @param tasks A sequence of tasks and functions to execute.
 * @returns A new `Task` representing the entire pipeline.
 *
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fromValue('user-123'),
 *   fetchUser,
 *   map(user => user.name),
 *   (name) => `Hello, ${name}!` // A plain function can be the final step
 * );
 *
 * const greeting = await run(workflow); // "Hello, John Doe!"
 * ```
 */
export function createWorkflow<C, V, R1>(a: Task<C, V, R1>): Task<C, V, R1>;
export function createWorkflow<C, V, R1, R2>(a: Task<C, V, R1>, b: Task<C, R1, R2> | ((val: R1) => R2)): Task<C, V, R2>;
export function createWorkflow<C, V, R1, R2, R3>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3> | ((val: R2) => R3)): Task<C, V, R3>;
export function createWorkflow<C, V, R1, R2, R3, R4>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>): Task<C, V, R4>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>): Task<C, V, R5>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>): Task<C, V, R6>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6, R7>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>, g: Task<C, R6, R7>): Task<C, V, R7>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6, R7, R8>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>, g: Task<C, R6, R7>, h: Task<C, R7, R8>): Task<C, V, R8>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6, R7, R8, R9>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>, g: Task<C, R6, R7>, h: Task<C, R7, R8>, i: Task<C, R8, R9>): Task<C, V, R9>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>, g: Task<C, R6, R7>, h: Task<C, R7, R8>, i: Task<C, R8, R9>, j: Task<C, R9, R10>): Task<C, V, R10>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>, g: Task<C, R6, R7>, h: Task<C, R7, R8>, i: Task<C, R8, R9>, j: Task<C, R9, R10>, k: Task<C, R10, R11>): Task<C, V, R11>;
export function createWorkflow<C, V, R1, R2, R3, R4, R5, R6, R7, R8, R9, R10, R11, R12>(a: Task<C, V, R1>, b: Task<C, R1, R2>, c: Task<C, R2, R3>, d: Task<C, R3, R4>, e: Task<C, R4, R5>, f: Task<C, R5, R6>, g: Task<C, R6, R7>, h: Task<C, R7, R8>, i: Task<C, R8, R9>, j: Task<C, R9, R10>, k: Task<C, R10, R11>, l: Task<C, R11, R12>): Task<C, V, R12>;
export function createWorkflow(...steps: any[]): Task<any, any, any> {
  if (steps.length === 0) {
    return async (context: any, v: any) => v; // Identity task
  }

  const toTask = (step: any): Task<any, any, any> => {
    if (typeof step === 'function' && step.__task_id) return step;
    // Convert plain function to task
    return async (context: any, value: any) => step(value);
  };

  const allTasks = steps.map(toTask);

  return async (context: any, initialValue: any) => {
    let currentValue = initialValue;
    for (const task of allTasks) {
      currentValue = await task(context, currentValue);
    }
    return currentValue;
  };
}

/**
 * An alias for {@link createWorkflow}.
 *
 * Chains multiple tasks together into a single, sequential workflow.
 * The output of each task is passed as the input to the next. This is the
 * primary composition utility for the library. Plain functions can be used
 * as steps and will be automatically wrapped in a `Task`.
 *
 * @param tasks A sequence of tasks and functions to execute.
 * @returns A new `Task` representing the entire pipeline.
 *
 * @example
 * ```typescript
 * const processUser = chain(
 *   fromValue('user-123'),
 *   fetchUser,
 *   map(user => user.name),
 *   (name) => `Hello, ${name}!`
 * );
 *
 * const greeting = await run(processUser); // "Hello, John Doe!"
 * ```
 * @see {@link createWorkflow}
 */
export const chain = createWorkflow;

/**
 * Starts a workflow with a static, known value.
 * @param value The static value to begin the workflow with.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fromValue({ id: 'user-123' }),
 *   map(data => data.id),
 * );
 * const userId = await run(workflow); // "user-123"
 * ```
 */
export function fromValue<T>(value: T): Task<any, null, T> {
  return async (context: any, _: null): Promise<T> => value;
}

/**
 * Starts a workflow by awaiting a `Promise`.
 * @param promise The promise to await.
 * @example
 * ```typescript
 * const userIdPromise = Promise.resolve('user-123');
 * const workflow = createWorkflow(fromPromise(userIdPromise), fetchUser);
 * const user = await run(workflow);
 * ```
 */
export function fromPromise<T>(promise: Promise<T>): Task<any, null, T> {
  return async (context: any, _: null): Promise<T> => promise;
}

/**
 * Starts a workflow by executing an async function that can access the context.
 * @param fn An async function that receives the context and returns a promise.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fromPromiseFn(ctx => ctx.auth.getUserId()),
 *   fetchUser
 * );
 * const user = await run(workflow);
 * ```
 */
export function fromPromiseFn<C extends { scope: Scope }, T>(
  fn: (context: C) => Promise<T>
): Task<C, null, T> {
  return async (context: C, _: null): Promise<T> => fn(context);
}


// =================================================================
// Section 2: Pipeable Operators and Direct Composition
// =================================================================

// --- Pipeable Operators (for use with `createWorkflow`) ---

/**
 * **Pipeable Operator:** Transforms the value in a workflow using a mapping function.
 * @param f A synchronous or async function that transforms the value.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fetchUser, // returns a User object
 *   map(user => user.name) // returns a string
 * );
 * const name = await run(workflow, 'user-123');
 * ```
 */
export function map<C extends { scope: Scope }, V, R>(
  f: (value: V, context: C) => R | Promise<R>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const result = f(value, context);
    return result instanceof Promise ? result : Promise.resolve(result);
  };
}

/**
 * **Pipeable Operator:** Transforms the value in a workflow into a new `Task`.
 * Also known as `chain` or `bind`.
 * @param f A function that takes a value and returns a new `Task`.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fetchUser,
 *   flatMap(user => fetchPostsForUser(user.id))
 * );
 * const posts = await run(workflow, 'user-123');
 * ```
 */
export function flatMap<C extends { scope: Scope }, V, R>(
  f: (value: V, context: C) => Task<C, V, R>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const nextTask = f(value, context);
    return nextTask(context, value);
  };
}

// --- Direct Composition Helpers (standalone) ---

/**
 * **Direct Composition:** Transforms the successful output of a task using a mapping function.
 * @param task The task whose output will be mapped.
 * @param f A synchronous or async function to transform the task's result.
 * @example
 * ```typescript
 * const fetchUserName = mapTask(fetchUser, user => user.name);
 * const name = await run(fetchUserName, 'user-123');
 * ```
 */
export function mapTask<C extends { scope: Scope }, V, A, B>(
  task: Task<C, V, A>,
  f: (value: A) => B | Promise<B>
): Task<C, V, B> {
  return async (context: C, value: V): Promise<B> => {
    const result = await task(context, value);
    return f(result);
  };
}

/**
 * **Direct Composition:** Transforms the successful output of a task into a new task.
 * @param task The initial task to execute.
 * @param f A function that takes the successful result of the first task and returns a new `Task`.
 * @example
 * ```typescript
 * const fetchUserAndPosts = andThenTask(fetchUser, user => fetchPostsForUser(user.id));
 * const posts = await run(fetchUserAndPosts, 'user-123');
 * ```
 */
export function andThenTask<C extends { scope: Scope }, In, A, B>(
  task: Task<C, In, A>,
  f: (value: A) => Task<C, A, B>
): Task<C, In, B> {
  return async (context: C, inputValue: In): Promise<B> => {
    const intermediateResult = await task(context, inputValue);
    const nextTask = f(intermediateResult);
    return nextTask(context, intermediateResult);
  };
}

/**
 * **Pipeable Operator:** Creates a new object from the input object, containing only the specified keys.
 * @param keys The keys to pick from the object.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fetchUser,
 *   pick('id', 'name')
 * );
 * const partialUser = await run(workflow, 'user-123'); // { id: '...', name: '...' }
 * ```
 */
export function pick<T extends object, K extends keyof T>(...keys: K[]): Task<any, T, Pick<T, K>> {
  return async (context: any, value: T): Promise<Pick<T, K>> => {
    const newObj = {} as Pick<T, K>;
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(value, key)) newObj[key] = value[key];
    return newObj;
  };
}


// =================================================================
// Section 3: Flow Control, Logic, and Side Effects
// =================================================================

/**
 * A higher-order task that conditionally executes another task if a predicate is `true`.
 * @param predicate A function that returns `true` to execute the task.
 * @param task The `Task` to execute conditionally. It must accept and return the same type.
 * @example
 * ```typescript
 * const sendEmailTask = defineTask(user => email.sendWelcome(user));
 * const workflow = createWorkflow(
 *   createUser,
 *   when(user => user.isVerified, sendEmailTask)
 * );
 * ```
 */
export function when<C extends { scope: Scope }, V>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  task: Task<C, V, V>
): Task<C, V, V> {
  return async (context: C, value: V): Promise<V> => {
    return (await predicate(value, context)) ? task(context, value) : value;
  };
}

/**
 * A higher-order task that conditionally executes another task if a predicate is `false`.
 * @param predicate A function that returns `false` to execute the task.
 * @param task The `Task` to execute conditionally.
 * @example
 * ```typescript
 * const showUpgradePrompt = defineTask(user => ui.showUpgrade(user));
 * const workflow = createWorkflow(
 *   fetchUser,
 *   unless(user => user.hasProPlan, showUpgradePrompt)
 * );
 * ```
 */
export function unless<C extends { scope: Scope }, V>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  task: Task<C, V, V>
): Task<C, V, V> {
  return when(async (v, c) => !(await predicate(v, c)), task);
}

/**
 * A higher-order task that executes another task repeatedly as long as a predicate returns `true`.
 * @param task The `Task` to execute in a loop.
 * @param predicate The condition to continue the loop.
 * @example
 * ```typescript
 * const fetchPage = defineTask(token => api.getData({ pageToken: token }));
 * const workflow = doWhile(fetchPage, page => page.hasNextPage);
 * await run(workflow, 'initial_token');
 * ```
 */
export function doWhile<C extends { scope: Scope }, V>(
  task: Task<C, V, V>,
  predicate: (value: V, context: C) => boolean | Promise<boolean>
): Task<C, V, V> {
  return async (context: C, initialValue: V): Promise<V> => {
    let currentValue = initialValue;
    while (await predicate(currentValue, context)) {
      if (context.scope.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      currentValue = await task(context, currentValue);
    }
    return currentValue;
  };
}

/**
 * **Pipeable Operator:** Performs a side effect (e.g., logging) but passes the input value through unchanged.
 * @param f A function to execute as a side effect.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   fetchUser,
 *   tap(user => console.log(`Processing user: ${user.id}`)),
 *   processUser
 * );
 * ```
 */
export function tap<C extends { scope: Scope }, V>(
  f: (value: V, context: C) => void | Promise<void>
): Task<C, V, V> {
  return async (context: C, value: V): Promise<V> => {
    await f(value, context);
    return value;
  };
}

/**
 * A `Task` that pauses the workflow for a specified duration.
 * @param ms The number of milliseconds to sleep.
 * @example
 * ```typescript
 * const workflow = createWorkflow(
 *   startOperation,
 *   sleep(2000), // wait 2 seconds
 *   finishOperation
 * );
 * ```
 */
export function sleep(ms: number): Task<any, any, void> {
  return async (context: any, _: any): Promise<void> => {
    if (context.scope.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      context.scope.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    });
  };
}


// =================================================================
// Section 4: Error Handling & Resilience
// =================================================================

/**
 * Performs a side effect if a task fails. It does not catch the error.
 * @param task The task to watch for errors.
 * @param f The side-effect function to run on error.
 * @example
 * ```typescript
 * const loggedFetch = tapError(fetchUser, (err, ctx) => {
 *   ctx.logger.error('Failed to fetch user', err);
 * });
 * // The workflow will still fail, but the error will be logged.
 * await run(loggedFetch, 'user-123');
 * ```
 */
export function tapError<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  f: (error: unknown, context: C) => void | Promise<void>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    try {
      return await task(context, value);
    } catch (error) {
      if (!isBacktrackSignal(error)) await f(error, context);
      throw error;
    }
  };
}

/**
 * Wraps a `Task` that might throw and converts its outcome into a `Result` object.
 * @param task The `Task` to wrap.
 * @example
 * ```typescript
 * const safeFetch = attempt(fetchUser);
 * const workflow = createWorkflow(
 *   fromValue('user-123'),
 *   safeFetch,
 *   map(result => result.isOk() ? `Found user` : `Error: ${result.error.message}`)
 * );
 * ```
 */
export function attempt<C extends { scope: Scope }, V, R, E extends Error>(
  task: Task<C, V, R>
): Task<C, V, Result<R, E>> {
  return async (context: C, value: V): Promise<Result<R, E>> => {
    try {
      return ok(await task(context, value));
    } catch (error) {
      if (isBacktrackSignal(error)) throw error;
      return err(error as E);
    }
  };
}

export interface RetryOptions {
  attempts?: number;
  delayMs?: number;
  backoff?: 'fixed' | 'exponential';
  shouldRetry?: (error: unknown) => boolean;
}

/**
 * Wraps a task with automatic, cancellable retry logic.
 * @param task The task to make resilient.
 * @param options Configuration for the retry behavior.
 * @example
 * ```typescript
 * const resilientFetch = withRetry(unstableApiCall, { attempts: 5 });
 * await run(resilientFetch);
 * ```
 */
export function withRetry<C extends { scope: Scope; logger?: Logger }, V, R>(
  task: Task<C, V, R>,
  options: RetryOptions = {}
): Task<C, V, R> {
  const { attempts = 3, delayMs = 100, backoff = 'exponential', shouldRetry = () => true } = options;
  
  // Return a function that matches the Task signature
  const retryTask = async (context: C, value: V): Promise<R> => {
    const logger = context.logger || noopLogger;
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      try {
        if (context.scope.signal.aborted) throw (context.scope.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        return await task(context, value);
      } catch (error) {
        lastError = error;
        if (isBacktrackSignal(error) || !shouldRetry(error)) throw error;
        if (i < attempts - 1) {
          const currentDelay = backoff === 'exponential' ? delayMs * 2 ** i : delayMs;
          logger.warn(`Task '${task.name || 'anonymous'}' failed. Retrying in ${currentDelay}ms... (Attempt ${i + 1}/${attempts})`, { error });
          // Simple delay without context dependency
          await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
      }
    }
    throw lastError;
  };
  
  // Copy the task ID if it exists for backtracking support
  if (task.__task_id) {
    retryTask.__task_id = task.__task_id;
  }
  
  return retryTask as Task<C, V, R>;
}

// =================================================================
// Section 5: Task Enhancers & Resource Management
// =================================================================

/**
 * Attaches a descriptive name to a task for better logging and debugging.
 * @param task The task to name.
 * @param name The new name for the task.
 * @example
 * ```typescript
 * const fetchTask = defineTask(api.get);
 * const namedFetch = withName(fetchTask, 'GetFromPrimaryAPI');
 * ```
 */
export function withName<C extends { scope: Scope }, V, R>(task: Task<C, V, R>, name: string): Task<C, V, R> {
  const namedTask: Task<C, V, R> = (ctx, val) => task(ctx, val);
  Object.defineProperty(namedTask, 'name', { value: name, configurable: true });
  if (task.__task_id) namedTask.__task_id = task.__task_id;
  if (task.__steps) namedTask.__steps = task.__steps;
  return namedTask;
}

/**
 * Creates a memoized version of a `Task` that caches its result based on
 * the input value (compared by deep equality).
 * @param task The `Task` to memoize.
 * @example
 * ```typescript
 * const memoizedFetch = memoize(fetchConfig);
 * await run(memoizedFetch, 'config-a'); // Fetches from network
 * await run(memoizedFetch, 'config-a'); // Returns from cache
 * ```
 */
export function memoize<C extends { scope: Scope }, V, R>(task: Task<C, V, R>): Task<C, V, R> {
  const cache = new Map<V, Promise<R>>();
  const findInCache = (key: V) => {
    for (const [k, v] of cache.entries()) if (deepEqual(k, key)) return v;
    return undefined;
  };
  return async (context: C, value: V): Promise<R> => {
    const cachedPromise = findInCache(value);
    if (cachedPromise) return cachedPromise;
    const newPromise = task(context, value);
    cache.set(value, newPromise);
    return newPromise;
  };
}

/**
 * Creates a `Task` that is guaranteed to execute only once. All subsequent
 * calls receive the same cached result. Ideal for initializing singletons.
 * @param task The `Task` to execute once.
 * @example
 * ```typescript
 * const initDb = once(defineTask(() => db.connect()));
 * await run(initDb); // Connects to DB
 * await run(initDb); // Returns existing connection promise
 * ```
 */
export function once<C extends { scope: Scope }, V, R>(task: Task<C, V, R>): Task<C, V, R> {
  let promise: Promise<R> | null = null;
  return async (context: C, value: V): Promise<R> => {
    if (promise) return promise;
    promise = task(context, value);
    return promise;
  };
}

/**
 * Wraps a task with a timeout. Throws a `TimeoutError` if the task exceeds the duration.
 * @param task The task to apply the timeout to.
 * @param durationMs The timeout duration in milliseconds.
 * @example
 * ```typescript
 * const fastTask = withTimeout(slowApiCall, 1000);
 * await run(fastTask); // Fails if slowApiCall takes > 1s
 * ```
 */
export function withTimeout<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  durationMs: number
): Task<C, V, R> {
  class TimeoutError extends Error {
    constructor() { super(`Task '${task.name || 'anonymous'}' timed out after ${durationMs}ms.`); this.name = 'TimeoutError'; }
  }
  
  const timeoutTask = async (context: C, value: V): Promise<R> => {
    const timeoutPromise = new Promise<never>((_, reject) => {
      const timerId = setTimeout(() => reject(new TimeoutError()), durationMs);
      context.scope.signal.addEventListener('abort', () => clearTimeout(timerId), { once: true });
    });
    return Promise.race([task(context, value), timeoutPromise]);
  };
  
  // Copy the task ID if it exists for backtracking support
  if (task.__task_id) {
    timeoutTask.__task_id = task.__task_id;
  }
  
  return timeoutTask as Task<C, V, R>;
}

export interface StateTools<S> {
  getState: () => S;
  setState: (updater: S | ((prevState: S) => S)) => void;
}

/**
 * Creates a task that encapsulates a stateful workflow. The state is private
 * and returned along with the final result.
 * @param initialState A function that produces the initial state.
 * @param workflowFn A function that receives state tools and returns the `Task` to execute.
 * @example
 * ```typescript
 * const workflow = withState(
 *   () => ({ count: 0 }),
 *   ({ setState, getState }) => createWorkflow(
 *     someTask,
 *     tap(() => setState(s => ({ count: s.count + 1 })))
 *   )
 * );
 * const { result, state } = await run(workflow); // state is { count: 1 }
 * ```
 */
export function withState<C extends { scope: Scope }, V, R, S>(
  initialState: (initialValue: V) => S,
  workflowFn: (tools: StateTools<S>) => Task<C, V, R>
): Task<C, V, { result: R; state: S }> {
  return async (context: C, initialValue: V): Promise<{ result: R; state: S }> => {
    let state: S = initialState(initialValue);
    const tools: StateTools<S> = {
      getState: () => state,
      setState: (updater) => { state = typeof updater === 'function' ? (updater as Function)(state) : updater; },
    };
    const result = await workflowFn(tools)(context, initialValue);
    return { result, state };
  };
}

/**
 * Wraps a task with an observability "span", logging its start, end, and duration.
 * @param task The `Task` to wrap with a span.
 * @param spanName An optional, explicit name for the span.
 * @example
 * ```typescript
 * const observedFetch = withSpan(fetchUser, 'FetchFromUpstreamAPI');
 * await run(observedFetch, 'user-123', { logger: console });
 * ```
 */
export function withSpan<C extends { scope: Scope; logger?: Logger }, V, R>(
  task: Task<C, V, R>,
  spanName?: string
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const logger = context.logger || noopLogger;
    const name = spanName || task.name || 'anonymous_task';
    logger.debug(`[Span Start] ${name}`);
    const startTime = performance.now();
    try {
      const result = await task(context, value);
      logger.info(`[Span End] ${name} - Success (${(performance.now() - startTime).toFixed(2)}ms)`);
      return result;
    } catch (error) {
      logger.error(`[Span End] ${name} - Failure (${(performance.now() - startTime).toFixed(2)}ms)`, { error });
      throw error;
    }
  };
}


// =================================================================
// Section 6: Advanced Scheduling, Batching, and Polling
// =================================================================

export interface ThrottleOptions {
  limit: number;
  intervalMs: number;
}

/**
 * Creates a throttled version of a task that respects a rate limit.
 * Calls exceeding the limit are queued and executed respecting cancellation.
 * @param task The `Task` to throttle.
 * @param options The throttling configuration.
 * @example
 * ```typescript
 * const throttledCall = withThrottle(apiCall, { limit: 5, intervalMs: 1000 });
 * // This task can now be called rapidly, but will only execute 5 times per second.
 * ```
 */
export function withThrottle<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  options: ThrottleOptions
): Task<C, V, R> {
  const { limit, intervalMs } = options;
  const callQueue: { value: V; resolve: (v: R) => void; reject: (r: any) => void; context: C }[] = [];
  let currentTokens = limit;
  let isProcessing = false;
  const refillInterval = setInterval(() => { currentTokens = Math.min(limit, currentTokens + 1); processQueue(); }, intervalMs / limit);
  if (typeof refillInterval.unref === 'function') refillInterval.unref();

  const processQueue = async () => {
    if (isProcessing || callQueue.length === 0) return;
    isProcessing = true;
    while (callQueue.length > 0 && currentTokens >= 1) {
      if (callQueue[0].context.scope.signal.aborted) {
        const { reject, context } = callQueue.shift()!;
        reject(context.scope.signal.reason ?? new DOMException('Aborted', 'AbortError'));
        continue;
      }
      currentTokens--;
      const { resolve, reject, value, context } = callQueue.shift()!;
      task(context, value).then(resolve).catch(reject);
    }
    isProcessing = false;
  };

  return async (context: C, value: V): Promise<R> => {
    return new Promise<R>((resolve, reject) => {
      callQueue.push({ value, resolve, reject, context });
      processQueue();
    });
  };
}

export interface PollOptions<R> {
  intervalMs: number;
  timeoutMs: number;
  until: (result: R) => boolean;
}

export class PollTimeoutError extends Error {
  constructor(timeoutMs: number) { super(`Polling timed out after ${timeoutMs}ms.`); this.name = 'PollTimeoutError'; }
}

/**
 * Creates a task that repeatedly executes another task until a condition is met or a timeout occurs.
 * @param task The `Task` to execute repeatedly.
 * @param options Configuration for the polling behavior.
 * @example
 * ```typescript
 * const waitForJob = withPoll(checkJobStatus, {
 *   intervalMs: 5000,
 *   timeoutMs: 60000,
 *   until: (status) => status.isDone,
 * });
 * await run(waitForJob, 'job-id');
 * ```
 */
export function withPoll<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  options: PollOptions<R>
): Task<C, V, R> {
  const pollingLoop = async (context: C, value: V): Promise<R> => {
    while (true) {
      const result = await task(context, value);
      if (options.until(result)) return result;
      await sleep(options.intervalMs)(context, null);
    }
  };

  return withTimeout(pollingLoop, options.timeoutMs);
}

export interface BatchingOptions {
  windowMs?: number;
}

/**
 * Creates a task that batches multiple calls into a single underlying call,
 * respecting cancellation for queued items.
 * @param batchFn A function that accepts keys and returns results in the same order.
 * @param options Configuration for the batching window.
 * @example
 * ```typescript
 * const fetchUserBatched = createBatchingTask(
 *   (ids: string[]) => api.users.getByIds(ids),
 *   { windowMs: 10 }
 * );
 * // Multiple parallel runs will be batched into one API call.
 * await Promise.all([run(fetchUserBatched, '1'), run(fetchUserBatched, '2')]);
 * ```
 */
export function createBatchingTask<C extends { scope: Scope }, K, R>(
  batchFn: (keys: K[]) => Promise<R[]>,
  options: BatchingOptions = {}
): Task<C, K, R> {
  let pending: { key: K; resolve: (v: R) => void; reject: (r: any) => void; signal: AbortSignal }[] = [];
  let timer: NodeJS.Timeout | null = null;
  const { windowMs = 10 } = options;
  const dispatch = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const currentBatch = pending;
    pending = [];
    if (currentBatch.length === 0) return;
    const activeCalls = currentBatch.filter(p => !p.signal.aborted);
    const abortedCalls = currentBatch.filter(p => p.signal.aborted);
    abortedCalls.forEach(p => p.reject(p.signal.reason ?? new DOMException('Aborted', 'AbortError')));
    if (activeCalls.length === 0) return;
    const keys = activeCalls.map(p => p.key);
    batchFn(keys)
      .then(results => {
        if (results.length !== activeCalls.length) throw new Error('Batch function must return an array of the same length as the keys array.');
        activeCalls.forEach((cb, i) => cb.resolve(results[i]));
      })
      .catch(error => activeCalls.forEach(cb => cb.reject(error)));
  };
  return async (context: C, key: K): Promise<R> => {
    return new Promise<R>((resolve, reject) => {
      const { scope } = context;
      pending.push({ key, resolve, reject, signal: scope.signal });
      if (!timer) timer = setTimeout(dispatch, windowMs);
    });
  };
}


/**
 * Creates a debounced version of a task. The task will only be executed
 * after a specified period of inactivity. All calls made during the debounce
 * window will receive the same promise, which resolves with the result of
 * the single eventual execution.
 *
 * @param task The `Task` to debounce.
 * @param durationMs The debounce duration in milliseconds.
 * @returns A new, debounced `Task`.
 *
 * @example
 * ```typescript
 * const debouncedSearch = withDebounce(searchApi, 300);
 * // Can be called rapidly, but the API call only happens 300ms after the last call.
 * run(debouncedSearch, 'query');
 * ```
 */
export function withDebounce<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  durationMs: number
): Task<C, V, R> {
  let timer: NodeJS.Timeout | null = null;
  let pendingPromise: Promise<R> | null = null;
  let lastCall: { value: V; context: C; resolve: (v: R) => void; reject: (r: any) => void; } | null = null;

  return async (context: C, value: V): Promise<R> => {
    // If a promise is already pending, return it.
    if (pendingPromise) {
      return pendingPromise;
    }

    // Clear any existing timer.
    if (timer) {
      clearTimeout(timer);
    }

    // Create a new promise for this invocation cycle.
    pendingPromise = new Promise((resolve, reject) => {
      // Store the details of the latest call.
      lastCall = { value, context, resolve, reject };

      timer = setTimeout(() => {
        if (lastCall) {
          const { value, context, resolve, reject } = lastCall;
          // Reset state before execution.
          pendingPromise = null;
          timer = null;
          lastCall = null;

          // Execute the task and resolve/reject the promise.
          task(context, value).then(resolve).catch(reject);
        }
      }, durationMs);
    });

    return pendingPromise;
  };
}