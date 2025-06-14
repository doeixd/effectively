/**
 * @module
 * This module provides a comprehensive suite of utility functions for creating,
 * composing, and enhancing Tasks. These tools enable powerful, declarative
 * workflows with built-in support for flow control, data transformation,
 * error handling, and resource management.
 *
 * The primary method of composition is the `createWorkflow` function, which allows for
 * creating clean, readable, and type-safe chains of operations.
 */

import { Result, ok, err } from "neverthrow";
import {
  type Task,
  type BaseContext,
  type Scope,
  type Logger,
  noopLogger,
  defineTask,
  getContext,
  isBacktrackSignal,
} from "./run";
import { TimeoutError as GenericTimeoutError } from "./utils";

// A lightweight deep-equal implementation for memoize key comparison
const deepEqual = (a: any, b: any): boolean => {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    if (a.constructor !== b.constructor) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++)
        if (!deepEqual(a[i], b[i])) return false;
      return true;
    }
    const keys = Object.keys(a);
    if (keys.length !== Object.keys(b).length) return false;
    for (const key of keys) {
      if (
        !Object.prototype.hasOwnProperty.call(b, key) ||
        !deepEqual(a[key], b[key])
      )
        return false;
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
export function pipe<A, B, C, D>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
): D;
export function pipe<A, B, C, D, E>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
): E;
export function pipe<A, B, C, D, E, F>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
): F;
export function pipe<A, B, C, D, E, F, G>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
): G;
export function pipe<A, B, C, D, E, F, G, H>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H,
): H;
export function pipe<A, B, C, D, E, F, G, H, I>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H,
  f8: (h: H) => I,
): I;
export function pipe<A, B, C, D, E, F, G, H, I, J>(
  value: A,
  f1: (a: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H,
  f8: (h: H) => I,
  f9: (i: I) => J,
): J;
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
export function flow(): <T>(arg: T) => T;
export function flow<A extends any[], B>(
  f1: (...args: A) => B,
): (...args: A) => B;
export function flow<A extends any[], B, C>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
): (...args: A) => C;
export function flow<A extends any[], B, C, D>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
): (...args: A) => D;
export function flow<A extends any[], B, C, D, E>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
): (...args: A) => E;
export function flow<A extends any[], B, C, D, E, F>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
): (...args: A) => F;
export function flow<A extends any[], B, C, D, E, F, G>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
): (...args: A) => G;
export function flow<A extends any[], B, C, D, E, F, G, H>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H,
): (...args: A) => H;
export function flow<A extends any[], B, C, D, E, F, G, H, I>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H,
  f8: (h: H) => I,
): (...args: A) => I;
export function flow<A extends any[], B, C, D, E, F, G, H, I, J>(
  f1: (...args: A) => B,
  f2: (b: B) => C,
  f3: (c: C) => D,
  f4: (d: D) => E,
  f5: (e: E) => F,
  f6: (f: F) => G,
  f7: (g: G) => H,
  f8: (h: H) => I,
  f9: (i: I) => J,
): (...args: A) => J;
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

// Helper to check if a function is a generator function
function isGeneratorFunction(fn: any): fn is (...args: any[]) => Generator {
  return Object.prototype.toString.call(fn) === "[object GeneratorFunction]";
}

// Helper to run a lifted generator function and adapt it to the Task signature
function runLiftedGenerator<V, R>(genFn: (value: V) => Generator<any, R, any>) {
  return async (context: BaseContext, value: V): Promise<R> => {
    const gen = genFn(value); // Get the iterator by calling the generator function

    return new Promise<R>((resolve, reject) => {
      function iterateGenerator(nextValueToPass?: any): void {
        try {
          const result = gen.next(nextValueToPass); // { value: yieldedValue, done: boolean }

          if (result.done) {
            resolve(result.value as R); // Generator returned
            return;
          }

          // If it yielded a promise, wait for it. Otherwise, pass the yielded value to the next iteration.
          Promise.resolve(result.value)
            .then((resolvedYieldedValue) =>
              iterateGenerator(resolvedYieldedValue),
            )
            .catch((errFromYieldedPromise) => {
              try {
                // Propagate error into the generator
                const resultFromThrow = gen.throw(errFromYieldedPromise); // Allow generator to catch it
                // Process resultFromThrow just like result from gen.next()
                if (resultFromThrow.done) {
                  resolve(resultFromThrow.value as R);
                  return;
                }
                Promise.resolve(resultFromThrow.value)
                  .then((res) => iterateGenerator(res))
                  .catch((innerErr) => reject(innerErr)); // Error from promise yielded after catch
              } catch (errorThrownByGenerator) {
                // This catches errors if gen.throw() itself throws (i.e., generator didn't catch it or re-threw)
                reject(errorThrownByGenerator);
              }
            });
        } catch (errorDuringNext) {
          // This catches errors if gen.next() itself throws (e.g. error in generator before first yield)
          reject(errorDuringNext);
        }
      }
      iterateGenerator(); // Start the generator execution
    });
  };
}

/**
 * A function that can be lifted into a Task, taking only the input value.
 * It can be synchronous, asynchronous, or a generator function.
 */
export type ValueTransformFn<V, R> =
  | ((value: V) => R) // Sync
  | ((value: V) => Promise<R>) // Async
  | ((value: V) => Generator<any, R, any>); // Generator

/**
 * A function that can be lifted into a Task, taking both context and input value.
 * It can be synchronous or asynchronous.
 */
export type ContextAwareFn<C extends BaseContext, V, R> =
  | ((context: C, value: V) => R) // Sync, context-aware
  | ((context: C, value: V) => Promise<R>); // Async, context-aware

/**
 * Represents any function or Task that can be a step in a `createWorkflow` pipeline.
 * It will be automatically lifted into a conformant Task if it's not one already.
 */
export type WorkflowStep<C extends BaseContext, V, R> =
  | Task<C, V, R>
  | ValueTransformFn<V, R>
  | ContextAwareFn<C, V, R>;

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
export function createWorkflow<C extends BaseContext, V, R1>(
  s1: WorkflowStep<C, V, R1>,
): Task<C, V, R1>;
export function createWorkflow<C extends BaseContext, V, R1, R2>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
): Task<C, V, R2>;
export function createWorkflow<C extends BaseContext, V, R1, R2, R3>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
): Task<C, V, R3>;
export function createWorkflow<C extends BaseContext, V, R1, R2, R3, R4>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
): Task<C, V, R4>;
export function createWorkflow<C extends BaseContext, V, R1, R2, R3, R4, R5>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
): Task<C, V, R5>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
): Task<C, V, R6>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
  s7: WorkflowStep<C, R6, R7>,
): Task<C, V, R7>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
  R8,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
  s7: WorkflowStep<C, R6, R7>,
  s8: WorkflowStep<C, R7, R8>,
): Task<C, V, R8>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
  R8,
  R9,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
  s7: WorkflowStep<C, R6, R7>,
  s8: WorkflowStep<C, R7, R8>,
  s9: WorkflowStep<C, R8, R9>,
): Task<C, V, R9>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
  R8,
  R9,
  R10,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
  s7: WorkflowStep<C, R6, R7>,
  s8: WorkflowStep<C, R7, R8>,
  s9: WorkflowStep<C, R8, R9>,
  s10: WorkflowStep<C, R9, R10>,
): Task<C, V, R10>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
  R8,
  R9,
  R10,
  R11,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
  s7: WorkflowStep<C, R6, R7>,
  s8: WorkflowStep<C, R7, R8>,
  s9: WorkflowStep<C, R8, R9>,
  s10: WorkflowStep<C, R9, R10>,
  s11: WorkflowStep<C, R10, R11>,
): Task<C, V, R11>;
export function createWorkflow<
  C extends BaseContext,
  V,
  R1,
  R2,
  R3,
  R4,
  R5,
  R6,
  R7,
  R8,
  R9,
  R10,
  R11,
  R12,
>(
  s1: WorkflowStep<C, V, R1>,
  s2: WorkflowStep<C, R1, R2>,
  s3: WorkflowStep<C, R2, R3>,
  s4: WorkflowStep<C, R3, R4>,
  s5: WorkflowStep<C, R4, R5>,
  s6: WorkflowStep<C, R5, R6>,
  s7: WorkflowStep<C, R6, R7>,
  s8: WorkflowStep<C, R7, R8>,
  s9: WorkflowStep<C, R8, R9>,
  s10: WorkflowStep<C, R9, R10>,
  s11: WorkflowStep<C, R10, R11>,
  s12: WorkflowStep<C, R11, R12>,
): Task<C, V, R12>;

// Implementation
export function createWorkflow(...steps: any[]): Task<any, any, any> {
  if (steps.length === 0) {
    // Return an identity task if no steps are provided
    const identityTask = async (context: any, v: any) => v;
    Object.defineProperty(identityTask, "name", {
      value: "identityWorkflow",
      configurable: true,
    });
    Object.defineProperty(identityTask, "__task_id", {
      value: Symbol("identityWorkflow"),
      configurable: true,
      enumerable: false,
      writable: false,
    });
    return identityTask;
  }

  const toTask = (stepOrFn: any): Task<any, any, any> => {
    if (typeof stepOrFn !== "function") {
      throw new Error(
        `Invalid workflow step: expected a function, Task, or generator function, but got ${typeof stepOrFn}.`,
      );
    }

    // 1. If it's already a Task (marked with __task_id from defineTask), use it directly.
    // Tasks are (context, value) => Promise<R>
    if (stepOrFn.__task_id) {
      return stepOrFn as Task<any, any, any>;
    }

    // 2. If it's a generator function: (value) => Generator<any, R, any>
    // Lift it to: (context, value) => Promise<R>
    if (isGeneratorFunction(stepOrFn)) {
      const liftedGenTask = runLiftedGenerator(
        stepOrFn as (value: any) => Generator<any, any, any>,
      );
      Object.defineProperty(liftedGenTask, "name", {
        value: stepOrFn.name || "liftedGeneratorTask",
        configurable: true,
      });
      return liftedGenTask;
    }

    // 3. If it's a function with arity 2, assume it's a "raw" context-aware function:
    // (context, value) => R | Promise<R>. Lift to (context, value) => Promise<R>.
    const fnStr = String(stepOrFn?.toString?.());
    if (
      stepOrFn.length === 2 &&
      (fnStr.includes("context") ||
        fnStr.includes("ctx") ||
        fnStr.includes("scope"))
    ) {
      const rawTaskWrapper = async (
        context: BaseContext,
        value: any,
      ): Promise<any> => {
        const result = stepOrFn(context, value);
        return Promise.resolve(result); // Handles both sync and async results
      };
      Object.defineProperty(rawTaskWrapper, "name", {
        value: stepOrFn.name || "liftedContextAwareFn",
        configurable: true,
      });
      return rawTaskWrapper;
    }

    // 4. Otherwise, it's a plain sync or async function taking one argument (the value):
    // (value) => R | Promise<R>. Lift to (context, value) => Promise<R>.
    const liftedPlainTask = async (
      context: BaseContext,
      value: any,
    ): Promise<any> => {
      const result = stepOrFn(value);
      return Promise.resolve(result); // Handles both sync returns and Promise returns
    };
    Object.defineProperty(liftedPlainTask, "name", {
      value: stepOrFn.name || "liftedValueTransformFn",
      configurable: true,
    });
    return liftedPlainTask;
  };

  const allLiftedTasks = steps.map(toTask);

  const composedWorkflow: Task<any, any, any> = async (
    context: any,
    initialValue: any,
  ) => {
    let currentValue = initialValue;
    for (const task of allLiftedTasks) {
      if (context.scope?.signal?.aborted) {
        // Check for cancellation before each step
        throw new DOMException("Workflow aborted", "AbortError");
      }
      currentValue = await task(context, currentValue);
    }
    return currentValue;
  };

  // For backtracking, the run engine needs to know the original steps.
  // Store the lifted tasks, as these are what will be executed.
  // Backtracking targets are identified by __task_id, which only defined Tasks will have.
  Object.defineProperty(composedWorkflow, "__steps", {
    value: Object.freeze([...allLiftedTasks]),
    configurable: true,
    enumerable: false,
    writable: false,
  });

  const stepNames = allLiftedTasks
    .map((t) => t.name || "anonymous_step")
    .join("_then_");
  Object.defineProperty(composedWorkflow, "name", {
    value: `workflow(${stepNames || "empty"})`,
    configurable: true,
  });
  // A composed workflow is also a task, give it a unique ID for potential nesting/backtracking.
  Object.defineProperty(composedWorkflow, "__task_id", {
    value: Symbol(`workflow_${stepNames || "empty"}`),
    configurable: true,
    enumerable: false,
    writable: false,
  });

  return composedWorkflow;
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
export function fromValue<T>(value: T): Task<BaseContext, null, T> {
  return async (context: BaseContext, _: null): Promise<T> => value;
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
export function fromPromise<T>(
  promise: Promise<T>,
): Task<BaseContext, null, T> {
  return async (context: BaseContext, _: null): Promise<T> => promise;
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
export function fromPromiseFn<C extends BaseContext, T>(
  fn: (context: C) => Promise<T>,
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
export function map<C extends BaseContext, V, R>(
  f: (value: V, context: C) => R | Promise<R>,
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const result = f(value, context);
    return result instanceof Promise ? result : Promise.resolve(result);
  };
}

/**
 * **Pipeable Operator:** Transforms the value in a workflow into a new `Task` by applying function `f`.
 * The function `f` receives the current value and context, and must return a new `Task`.
 * This new `Task` is then executed with the same context and the current value.
 * Also known as `bind` or `chain` in monadic terms.
 *
 * @template C The context type.
 * @template V The input value type for this step of the workflow.
 * @template RNext The result type of the `Task` returned by `f`.
 * @param f A function that takes the current value (`V`) and context (`C`), and returns a new `Task<C, V, RNext>`.
 * @returns A `Task<C, V, RNext>` that represents the execution of the task returned by `f`.
 *
 * @example
 * ```typescript
 * const fetchUserAndThenPosts = createWorkflow(
 *   fetchUser, // Task<C, string, User>
 *   flatMap((user: User, context: C) => fetchPostsForUser(context, user.id)) // user.id is string, fetchPostsForUser returns Task<C, string, Post[]>
 * );
 * // The type of fetchPostsForUser would effectively be Task<C, string, Post[]>
 * // flatMap needs Task<C, User, Post[]> if the task from f uses 'user' as input.
 * // If f uses user.id as input for fetchPostsForUser, the V for fetchPostsForUser is string.
 * // The V for the *returned task from f* should match the input type it expects.
 *
 * // Corrected example logic:
 * const fetchPostsTaskForUser = (user: User): Task<AppContext, User, Post[]> =>
 *   defineTask(async (context: AppContext, u: User) => { // u here is 'user'
 *     return api.fetchPosts(u.id);
 *   });
 *
 * const workflow = createWorkflow(
 *   fetchUserById, // Task<AppContext, string, User>
 *   flatMap((user: User, ctx: AppContext) => fetchPostsTaskForUser(user)) // fetchPostsTaskForUser(user) is Task<AppContext, User, Post[]>
 * );
 * // The resulting workflow takes string (userId) and returns Post[]
 * ```
 */
export function flatMap<C extends BaseContext, V, RNext>(
  // f's returned Task takes VInNext as input, which could be different from V.
  // However, the common flatMap pattern implies the returned Task uses V (or part of V) as its input.
  // For maximum flexibility, VInNext could be a separate generic, but let's stick to common usage.
  // If f returns Task<C, VAlt, RNext>, then the flatMap must correctly provide VAlt.
  // The current signature Task<C,V,RNext> means the task from f *also* takes V as input.
  f: (value: V, context: C) => Task<C, V, RNext>,
): Task<C, V, RNext> {
  const flatMapTask: Task<C, V, RNext> = async (
    context: C,
    value: V,
  ): Promise<RNext> => {
    const nextTask: Task<C, V, RNext> = f(value, context);
    if (typeof nextTask !== "function" || !nextTask.name === undefined) {
      // Basic check
      throw new Error("flatMap function f must return a valid Task.");
    }
    return nextTask(context, value); // Execute the returned task
  };

  // Enhancer property propagation
  Object.defineProperty(flatMapTask, "name", {
    value: `flatMap(${f.name || "anonymousFn"})`,
    configurable: true,
  });
  // flatMap creates a new logical step; it typically wouldn't propagate __task_id or __steps from 'f'
  // as it's not the same task but a new one derived from it.

  return flatMapTask;
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
export function mapTask<C extends BaseContext, V, A, B>(
  task: Task<C, V, A>,
  f: (value: A) => B | Promise<B>,
): Task<C, V, B> {
  return async (context: C, value: V): Promise<B> => {
    const result = await task(context, value);
    return f(result);
  };
}

/**
 * **Direct Composition:** Executes a task, then uses its result to produce and execute a second task.
 * The function `f` receives the result of the first `task` and must return a new `Task`.
 * This new `Task` is then executed. The context is passed through.
 *
 * @template C The context type.
 * @template In The input type of the initial `task`.
 * @template A The result type of the initial `task` (and input type to `f`).
 * @template RNext The result type of the `Task` returned by `f`.
 * @param task The initial `Task<C, In, A>` to execute.
 * @param f A function that takes the result `A` of the first task and returns a new `Task<C, A, RNext>`.
 *          The returned task will be called with the context and `A` as its input.
 * @returns A new `Task<C, In, RNext>` representing the sequential composition.
 *
 * @example
 * ```typescript
 * const fetchUserById: Task<Ctx, string, User> = defineTask(async (ctx, id) => api.getUser(id));
 * const fetchPostsForUserTask = (user: User): Task<Ctx, User, Post[]> =>
 *   defineTask(async (ctx, u) => api.getPosts(u.id));
 *
 * const fetchUserAndTheirPosts = andThenTask(
 *   fetchUserById,
 *   (user: User) => fetchPostsForUserTask(user) // This returns Task<Ctx, User, Post[]>
 * );
 * // `fetchUserAndTheirPosts` is Task<Ctx, string, Post[]>
 * // When run: fetchUserById('123') -> User -> fetchPostsForUserTask(User)(User) -> Post[]
 * ```
 */
export function andThenTask<C extends BaseContext, In, A, RNext>(
  task: Task<C, In, A>,
  f: (value: A) => Task<C, A, RNext>, // f produces a task that takes A as input
): Task<C, In, RNext> {
  const andThenCompositionTask: Task<C, In, RNext> = async (
    context: C,
    inputValue: In,
  ): Promise<RNext> => {
    const intermediateResult: A = await task(context, inputValue);
    const nextTask: Task<C, A, RNext> = f(intermediateResult);
    if (typeof nextTask !== "function" || nextTask.name === undefined) {
      // Basic check
      throw new Error("andThenTask function f must return a valid Task.");
    }
    // The `nextTask` expects `A` as its value input, which is `intermediateResult`.
    return nextTask(context, intermediateResult);
  };

  Object.defineProperty(andThenCompositionTask, "name", {
    value: `andThen(${task.name || "anonymousTask"}, ${f.name || "anonymousFn"})`,
    configurable: true,
  });
  // This creates a new composite task. Propagating __task_id from the first task
  // might be misleading if backtracking targets the composite.
  // If `task` was a workflow, its `__steps` are internal to it.

  return andThenCompositionTask;
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
export function pick<T extends object, K extends keyof T>(
  ...keys: K[]
): Task<BaseContext, T, Pick<T, K>> {
  return async (context: BaseContext, value: T): Promise<Pick<T, K>> => {
    const newObj = {} as Pick<T, K>;
    for (const key of keys)
      if (Object.prototype.hasOwnProperty.call(value, key))
        newObj[key] = value[key];
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
export function when<C extends BaseContext, V>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  task: Task<C, V, V>,
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
export function unless<C extends BaseContext, V>(
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
  task: Task<C, V, V>,
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
export function doWhile<C extends BaseContext, V>(
  task: Task<C, V, V>,
  predicate: (value: V, context: C) => boolean | Promise<boolean>,
): Task<C, V, V> {
  return async (context: C, initialValue: V): Promise<V> => {
    let currentValue = initialValue;
    while (await predicate(currentValue, context)) {
      if (context.scope.signal.aborted)
        throw new DOMException("Aborted", "AbortError");
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
export function tap<C extends BaseContext, V>(
  f: (value: V, context: C) => void | Promise<void>,
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
export function sleep(ms: number): Task<BaseContext, any, void> {
  return async (context: BaseContext, _: any): Promise<void> => {
    if (context.scope.signal.aborted)
      throw new DOMException("Aborted", "AbortError");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      context.scope.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  };
}

// =================================================================
// Section 4: Error Handling & Resilience
// =================================================================

/**
 * A higher-order task that performs a side effect if the wrapped `task` throws an error.
 * The original error is always re-thrown after the side effect function `onErrorFn` completes.
 * This utility is useful for logging, metrics, or other observational side effects.
 *
 * `BacktrackSignal`s are ignored by `onErrorFn` and re-thrown immediately.
 *
 * @template C The context type for the task and the error handler.
 * @template V The input value type of the task.
 * @template R The result type of the task if successful.
 * @template E The expected type of the error. If `errorConstructor` is provided,
 *             `onErrorFn` will only be called for errors matching that constructor,
 *             and the `error` parameter will be correctly typed as an instance of `E`.
 * @param task The `Task<C, V, R>` to wrap.
 * @param onErrorFn A function that will be called if `task` throws a matching error.
 *                  It receives the typed error instance and the current context.
 * @param errorConstructor (Optional) The specific error class to catch. If provided,
 *                         the handler will only run for instances of this error.
 * @returns A new `Task<C, V, R>` that incorporates the error tapping behavior.
 *
 * @example
 * ```typescript
 * const resilientTask = tapError(
 *   flakyTask,
 *   (error, context) => { // `error` is a NetworkError instance here
 *     context.logger.error('Network failure occurred', { cause: error });
 *   },
 *   NetworkError // Only tap into NetworkError instances
 * );
 * ```
 */
export function tapError<C extends BaseContext, V, R, E extends Error = Error>(
  task: Task<C, V, R>,
  onErrorFn: (error: E, context: C) => void | Promise<void>,
  errorConstructor?: new (...args: any[]) => E,
): Task<C, V, R> {
  const tappedTaskLogic: Task<C, V, R> = async (
    context: C,
    value: V,
  ): Promise<R> => {
    try {
      return await task(context, value);
    } catch (error) {
      // Do not trigger the side effect for BacktrackSignals
      if (isBacktrackSignal(error)) {
        throw error;
      }

      // Check if we should handle this error based on the constructor
      const shouldHandle =
        !errorConstructor || error instanceof errorConstructor;

      if (shouldHandle) {
        // Perform the side effect.
        try {
          await onErrorFn(error as E, context);
        } catch (tapFnError) {
          // If the onErrorFn itself throws, log it but prioritize the original error.
          const logger = (context as C & { logger?: Logger }).logger || console;
          logger.error(
            `[tapError] An error occurred within the error-tapping function itself while handling another error. The original error will be re-thrown.`,
            { tapFnError, originalError: error },
          );
        }
      }

      // Always re-throw the original error from the task.
      throw error;
    }
  };

  // Set descriptive name and propagate properties
  Object.defineProperty(tappedTaskLogic, "name", {
    value: `tapError(${task.name || "anonymousTask"}, ${onErrorFn.name || "onErrorFn"})`,
    configurable: true,
  });

  if (task.__task_id) {
    Object.defineProperty(tappedTaskLogic, "__task_id", {
      value: task.__task_id,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  if (task.__steps) {
    Object.defineProperty(tappedTaskLogic, "__steps", {
      value: task.__steps,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return tappedTaskLogic;
}

/**
 * Default error mapper for `attempt` when a more specific mapping to `E` is not provided.
 * It checks if the caught error is an instance of `Error`. If so, it's cast to `E`.
 * Otherwise, it wraps the caught value in a new `Error` instance and then casts to `E`.
 * This cast assumes `E` is `Error` or one of its subtypes.
 */
function defaultAttemptErrorMapper<E extends Error>(caughtError: unknown): E {
  if (caughtError instanceof Error) {
    return caughtError as E; // Assumes E is compatible with Error or is Error itself
  }
  // For non-Error types, wrap them in a generic Error instance.
  return new Error(
    String(
      caughtError !== undefined ? caughtError : "Unknown error during attempt",
    ),
  ) as E;
}

/**
 * Wraps a `Task` that might throw an error, converting its outcome into a
 * `Result<R, E>` object from `neverthrow`.
 *
 * If the original `task` successfully resolves, this function returns `Ok<R>`.
 * If the original `task` throws an error (and it's not a `BacktrackSignal`),
 * this function catches it and returns `Err<E>`.
 * `BacktrackSignal`s are re-thrown to allow non-linear control flow.
 *
 * @template C The context type for the task.
 * @template V The input value type of the task.
 * @template R The success result type of the task.
 * @template E The expected error type if the task fails (must extend `Error`). Defaults to `Error`.
 * @param task The `Task<C, V, R>` to wrap.
 * @param mapErrorToE An optional function to map a caught `unknown` error value
 *                    to the desired error type `E`. If not provided, a default
 *                    mapper is used which attempts to cast `Error` instances or
 *                    wraps non-`Error` values in a new `Error`.
 * @returns A new `Task<C, V, Result<R, E>>` that always resolves (never throws,
 *          except for `BacktrackSignal`).
 *
 * @example
 * ```typescript
 * const fetchUserTask = defineTask(async (ctx, userId: string) => {
 *   if (userId === 'bad-id') throw new Error('Invalid user ID');
 *   return { id: userId, name: 'John Doe' };
 * });
 *
 * const safeFetchUser = attempt(fetchUserTask);
 *
 * const workflow = createWorkflow(
 *   fromValue('user-123'), // or 'bad-id'
 *   safeFetchUser,
 *   map(result =>
 *     result.match(
 *       user => `User: ${user.name}`,
 *       error => `Failed to fetch user: ${error.message}`
 *     )
 *   )
 * );
 *
 * const outcome = await run(workflow);
 * console.log(outcome);
 * ```
 */
export function attempt<C extends BaseContext, V, R, E extends Error = Error>(
  task: Task<C, V, R>,
  mapErrorToE: (caughtError: unknown) => E = defaultAttemptErrorMapper,
): Task<C, V, Result<R, E>> {
  const attemptTaskLogic: Task<C, V, Result<R, E>> = async (
    context: C,
    value: V,
  ): Promise<Result<R, E>> => {
    try {
      const resultValue = await task(context, value);
      return ok(resultValue);
    } catch (error) {
      if (isBacktrackSignal(error)) {
        throw error; // Propagate BacktrackSignal for control flow
      }
      // Use the error mapper to convert the caught error to type E
      return err(mapErrorToE(error));
    }
  };

  // Set descriptive name and propagate properties
  Object.defineProperty(attemptTaskLogic, "name", {
    value: `attempt(${task.name || "anonymousTask"})`,
    configurable: true,
  });

  if (task.__task_id) {
    Object.defineProperty(attemptTaskLogic, "__task_id", {
      value: task.__task_id, // Or a new Symbol
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  if (task.__steps) {
    Object.defineProperty(attemptTaskLogic, "__steps", {
      value: task.__steps,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return attemptTaskLogic;
}

export interface RetryOptions<E = Error> {
  // Added E generic for error type
  /**
   * Maximum number of attempts (including the initial call).
   * @default 3
   */
  attempts?: number;
  /**
   * Initial delay in milliseconds before the first retry.
   * @default 100
   */
  delayMs?: number;
  /**
   * Backoff strategy for delays between retries.
   * - 'fixed': Uses `delayMs` for all retries.
   * - 'exponential': Doubles the delay for each subsequent retry (`delayMs * 2^i`).
   * @default 'exponential'
   */
  backoff?: "fixed" | "exponential";
  /**
   * A function to determine if a specific error should trigger a retry.
   * By default, retries on any error that is not a `BacktrackSignal`.
   * @param error The error thrown by the task.
   * @returns `true` if the task should be retried for this error, `false` otherwise.
   */
  shouldRetry?: (error: E | unknown) => boolean; // E | unknown for flexibility
  /**
   * An optional jitter function to apply to the delay.
   * 'none': No jitter.
   * 'full': Adds a random amount between 0 and the calculated delay.
   * (value: number) => number: A custom function that takes the calculated delay and returns the jittered delay.
   * @default 'none'
   */
  jitter?: "none" | "full" | ((delay: number) => number);
}

/**
 * Wraps a task with automatic, cancellable retry logic.
 * If the wrapped task fails, it will be retried according to the specified options.
 * The delay between retries can be fixed or exponential and can include jitter.
 * Retries are aborted if the context's scope signal is aborted.
 *
 * @template C The context type, which must include `scope` and can optionally include `logger`.
 * @template V The input value type of the task.
 * @template R The result type of the task.
 * @template E The expected primary error type for the `shouldRetry` predicate.
 * @param task The `Task` to make resilient.
 * @param options Configuration for the retry behavior.
 * @returns A new `Task` that incorporates retry logic.
 *
 * @example
 * ```typescript
 * const resilientFetch = withRetry(fetchData, {
 *   attempts: 5,
 *   delayMs: 200,
 *   backoff: 'exponential',
 *   jitter: 'full',
 *   shouldRetry: (error) => error instanceof NetworkError || error.status === 503,
 * });
 * await run(resilientFetch, requestData);
 * ```
 */
export function withRetry<
  C extends BaseContext & { logger?: Logger },
  V,
  R,
  E extends Error = Error, // Default E to Error
>(task: Task<C, V, R>, options: RetryOptions<E> = {}): Task<C, V, R> {
  const {
    attempts = 3,
    delayMs = 100,
    backoff = "exponential",
    // Default shouldRetry to check for non-BacktrackSignal errors.
    shouldRetry = (error): error is E => !isBacktrackSignal(error),
    jitter = "none",
  } = options;

  if (attempts <= 0) {
    throw new Error("Retry attempts must be positive.");
  }

  const applyJitter = (currentDelay: number): number => {
    if (jitter === "none") {
      return currentDelay;
    }
    if (jitter === "full") {
      return currentDelay + Math.random() * currentDelay;
    }
    return jitter(currentDelay);
  };

  const retryTaskLogic = async (context: C, value: V): Promise<R> => {
    const logger = context.logger || noopLogger;
    let lastError: E | unknown = new Error("Task was not attempted."); // Initialize with a generic error

    for (let attemptCount = 0; attemptCount < attempts; attemptCount++) {
      try {
        // Check for cancellation before each attempt
        if (context.scope.signal.aborted) {
          // If already aborted before first attempt, or between retries
          throw (
            context.scope.signal.reason ??
            new DOMException("Aborted before attempt", "AbortError")
          );
        }
        return await task(context, value);
      } catch (error) {
        lastError = error; // Store the caught error

        // If it's a BacktrackSignal, or shouldRetry returns false, or it's the last attempt, re-throw.
        if (
          isBacktrackSignal(error) ||
          !shouldRetry(error as E | unknown) ||
          attemptCount === attempts - 1
        ) {
          throw error;
        }

        // Calculate delay for the next retry
        let currentDelay = delayMs;
        if (backoff === "exponential" && attemptCount > 0) {
          // No delay before first retry if delayMs is for "after first failure"
          currentDelay = delayMs * 2 ** attemptCount;
        }
        currentDelay = applyJitter(currentDelay);

        logger.warn(
          `Task '${task.name || "anonymous"}' failed (attempt ${attemptCount + 1}/${attempts}). Retrying in ${Math.round(currentDelay)}ms...`,
          { originalError: error }, // Log the specific error that caused the retry
        );

        try {
          // Wait for the delay, respecting cancellation
          await sleep(currentDelay)(context, null);
        } catch (sleepError) {
          // If sleep itself was aborted (e.g., context.scope.signal)
          if (
            sleepError instanceof DOMException &&
            sleepError.name === "AbortError"
          ) {
            logger.warn(
              `[withRetry - ${task.name || "anonymous"}] Retry delay aborted (attempt ${attemptCount + 1}/${attempts}). Re-throwing original task error.`,
              { originalError: error, abortReason: sleepError },
            );
            // When delay is aborted, standard behavior is to not proceed with more retries
            // and let the last known error from the task propagate.
            throw lastError; // Or throw sleepError if aborting the retry process itself is preferred.
          }
          // Should not happen with current sleep, but good practice
          throw sleepError;
        }
      }
    }
    // This line should theoretically be unreachable if attempts > 0,
    // as the loop will either return a result or throw an error (either lastError or from within).
    // But to satisfy TypeScript and as a safeguard:
    throw lastError;
  };

  // Create the task function with potential properties
  const enhancedTask: Task<C, V, R> = retryTaskLogic;

  Object.defineProperty(enhancedTask, "name", {
    value: `withRetry(${task.name || "anonymous"}, attempts=${attempts})`,
    configurable: true,
  });

  if (task.__task_id) {
    Object.defineProperty(enhancedTask, "__task_id", {
      value: task.__task_id, // Or a new Symbol for distinctness if enhancers create new backtrackable steps
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  if (task.__steps) {
    Object.defineProperty(enhancedTask, "__steps", {
      value: task.__steps,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return enhancedTask;
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
export function withName<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  name: string,
): Task<C, V, R> {
  const namedTask: Task<C, V, R> = (ctx, val) => task(ctx, val);
  Object.defineProperty(namedTask, "name", { value: name, configurable: true });
  if (task.__task_id) namedTask.__task_id = task.__task_id;
  if (task.__steps) namedTask.__steps = task.__steps;
  return namedTask;
}

/**
 * Creates a memoized version of a `Task` that caches its result based on
 * the input value. The input value is used as a key in an internal Map.
 * For object inputs, a deep equality check is performed to find matching keys.
 * The cache is specific to each instance of the memoized task created by this function.
 *
 * @template C The context type.
 * @template V The input value type for the task. Must be usable as a Map key or comparable with `deepEqual`.
 * @template R The resolved output value type of the task.
 * @param task The `Task` to memoize.
 * @param options Optional configuration for memoization.
 * @param options.cacheKeyFn An optional function to generate a custom cache key from the input value.
 *                         Useful for complex objects or when `deepEqual` is not suitable/performant.
 * @returns A new `Task` that caches results of the original task.
 *
 * @example
 * ```typescript
 * const memoizedFetchConfig = memoize(fetchConfig);
 * await run(memoizedFetchConfig, 'config-a'); // Fetches from network
 * await run(memoizedFetchConfig, 'config-a'); // Returns from cache
 *
 * const memoizedComplexOp = memoize(complexObjectOperation, {
 *   cacheKeyFn: (obj) => obj.id // Use only 'id' property for caching
 * });
 * ```
 */
export function memoize<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  options?: {
    cacheKeyFn?: (value: V) => string | number | symbol | boolean;
  },
): Task<C, V, R> {
  // Each call to memoize gets its own private cache.
  const cache = new Map<any, Promise<R>>(); // Key can be primitive or complex if no cacheKeyFn

  const getCacheKey = options?.cacheKeyFn
    ? options.cacheKeyFn
    : (value: V): V | string => {
        // For primitive types, use the value itself as the key.
        // For objects, if no custom key function, we'll rely on finding via deepEqual or stringify.
        // Stringifying can be lossy or inconsistent for complex objects, so deepEqual is preferred for lookup.
        // However, Map itself uses SameValueZero for keys, so distinct objects won't match.
        // So, if it's an object and no cacheKeyFn, we'll use the object itself and iterate for deepEqual.
        if (typeof value === "object" && value !== null) {
          return value; // Store the object, lookup will use deepEqual iteration.
        }
        return value; // Primitives can be direct keys.
      };

  const findInCache = (value: V, generatedKey: any): Promise<R> | undefined => {
    if (options?.cacheKeyFn || typeof value !== "object" || value === null) {
      return cache.get(generatedKey);
    }
    // If it's an object and no cacheKeyFn, iterate and deepEqual
    for (const [k, v] of cache.entries()) {
      if (deepEqual(k, value)) {
        // `value` here is the original object input
        return v;
      }
    }
    return undefined;
  };

  const memoizedTask: Task<C, V, R> = async (
    context: C,
    value: V,
  ): Promise<R> => {
    const cacheKey = getCacheKey(value);
    const cachedPromise = findInCache(value, cacheKey);

    if (cachedPromise) {
      // If a promise is found, return it. This handles concurrent calls for the same input correctly,
      // as they will all await the same initial promise.
      return cachedPromise;
    }

    // Execute the task, store the promise in cache, then return it.
    // Store the promise itself, not the result, to handle inflight requests.
    const newPromise = task(context, value).catch((err) => {
      // If the task fails, remove the promise from cache to allow retries.
      // This behavior is debatable: some might want to cache failures too.
      // For simplicity, we remove on failure.
      if (options?.cacheKeyFn || typeof value !== "object" || value === null) {
        cache.delete(cacheKey);
      } else {
        // Iterate to find and delete the object key if no custom key fn
        for (const k of cache.keys()) {
          if (deepEqual(k, value)) {
            cache.delete(k);
            break;
          }
        }
      }
      throw err; // Re-throw the error
    });

    cache.set(cacheKey, newPromise); // Store the actual object if no cacheKeyFn for deepEqual lookup
    return newPromise;
  };

  // Propagate name and task ID for consistency and debugging
  Object.defineProperty(memoizedTask, "name", {
    value: `memoized(${task.name || "anonymous"})`,
    configurable: true,
  });
  if (task.__task_id) {
    memoizedTask.__task_id = task.__task_id; // Or a new Symbol(`memoized_${task.__task_id.description}`)
  }
  if (task.__steps) {
    // If the original task was a workflow
    memoizedTask.__steps = task.__steps;
  }

  return memoizedTask;
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
export function once<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
): Task<C, V, R> {
  let promise: Promise<R> | null = null;
  return async (context: C, value: V): Promise<R> => {
    if (promise) return promise;
    promise = task(context, value);
    return promise;
  };
}

/**
 * Custom error thrown when a task wrapped by `withTimeout` exceeds its allocated execution time.
 */
export class TimeoutError extends Error {
  public readonly _tag = "TimeoutError" as const; // For easier type guarding if needed
  constructor(taskName: string, durationMs: number) {
    super(`Task '${taskName}' timed out after ${durationMs}ms.`);
    this.name = "TimeoutError";
    // Ensure the prototype chain is correct for custom errors
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Wraps a task with a timeout. If the task does not complete within the specified
 * duration, it will be rejected with a `TimeoutError`.
 * The timeout mechanism respects the task's context `AbortSignal`: if the signal
 * is aborted, the timeout timer is cleared.
 *
 * @template C The context type, which must include `scope`.
 * @template V The input value type of the task.
 * @template R The result type of the task.
 * @param task The `Task` to apply the timeout to.
 * @param durationMs The timeout duration in milliseconds. Must be non-negative.
 * @returns A new `Task` that will either resolve with the original task's result
 *          or reject with a `TimeoutError` or an error from the original task
 *          (including an AbortError if the context is cancelled).
 *
 * @example
 * ```typescript
 * const verySlowTask = defineTask(async () => {
 *   await new Promise(resolve => setTimeout(resolve, 5000)); // 5s delay
 *   return 'done';
 * });
 *
 * const quickTask = withTimeout(verySlowTask, 1000); // 1s timeout
 *
 * try {
 *   await run(quickTask, null);
 * } catch (error) {
 *   if (error instanceof TimeoutError) {
 *     console.error('Operation timed out!'); // This will be caught
 *   } else {
 *     console.error('Other error:', error);
 *   }
 * }
 * ```
 */
export function withTimeout<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  durationMs: number,
): Task<C, V, R> {
  if (durationMs < 0) {
    throw new Error("Timeout durationMs must be non-negative.");
  }

  // Define TimeoutError class outside the returned task function if preferred,
  // but keeping it here for closure over task.name and durationMs is fine.
  // For this version, we'll use the exported TimeoutError class.
  const taskNameForError = task.name || "anonymous";

  const timeoutEnhancedTask: Task<C, V, R> = (
    context: C,
    value: V,
  ): Promise<R> => {
    let timerId: ReturnType<typeof setTimeout> | undefined = undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timerId = setTimeout(() => {
        // Important: Clear the listener for 'abort' when the timeout fires
        // to prevent potential memory leaks if the context outlives this operation.
        if (timerId !== undefined) {
          // Check because it might have been cleared by abort
          context.scope.signal.removeEventListener("abort", abortListener);
        }
        reject(new TimeoutError(taskNameForError, durationMs));
      }, durationMs);
    });

    const abortListener = () => {
      if (timerId !== undefined) {
        clearTimeout(timerId);
        timerId = undefined; // Indicate timer is cleared
        // No need to reject timeoutPromise here; if the main task respects abort,
        // Promise.race will settle with the main task's abort-related rejection.
        // If the main task doesn't respect abort, it might still complete,
        // but this timeout mechanism itself is cleaned up.
      }
    };

    // Listen for abortion to clear the timeout
    // Use { once: true } as we only need to clear it once.
    context.scope.signal.addEventListener("abort", abortListener, {
      once: true,
    });

    return Promise.race([
      task(context, value), // The original task execution
      timeoutPromise,
    ]).finally(() => {
      // Cleanup: Regardless of outcome (resolve, reject from task, or reject from timeoutPromise),
      // ensure the timer is cleared if it hasn't fired yet, and remove the abort listener.
      // This is crucial if the main `task` resolves/rejects *before* the timeout.
      if (timerId !== undefined) {
        clearTimeout(timerId);
      }
      // The abortListener is {once: true}, so it auto-removes if fired.
      // If it wasn't fired, remove it manually.
      // Note: Checking signal.aborted here might be too late if the event already fired.
      // Relying on {once: true} is generally sufficient. For robustness, if not using {once:true},
      // you would always call removeEventListener.
      context.scope.signal.removeEventListener("abort", abortListener);
    });
  };

  // Set a descriptive name for the enhanced task
  Object.defineProperty(timeoutEnhancedTask, "name", {
    value: `withTimeout(${task.name || "anonymous"}, ${durationMs}ms)`,
    configurable: true,
  });

  // Copy internal properties like __task_id and __steps for consistency
  if (task.__task_id) {
    Object.defineProperty(timeoutEnhancedTask, "__task_id", {
      value: task.__task_id, // Or a new Symbol if enhancers should be distinct steps
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  if (task.__steps) {
    Object.defineProperty(timeoutEnhancedTask, "__steps", {
      value: task.__steps,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return timeoutEnhancedTask;
}

/**
 * A unique symbol used to store StateTools in the context.
 * @internal
 */
const STATE_TOOLS_KEY = Symbol("effectively.stateTools");

/**
 * Tools for interacting with the state managed by `withState`.
 * These are injected into the context for the wrapped task.
 * @template S The type of the state.
 */
export interface StateTools<S> {
  /**
   * Retrieves the current value of the encapsulated state.
   * @returns The current state `S`.
   */
  getState: () => S;
  /**
   * Updates the encapsulated state.
   * @param updater Either a new state value `S` or a function that takes the
   *                previous state `(prevState: S)` and returns the new state `S`.
   */
  setState: (updater: S | ((prevState: S) => S)) => void;
}

/**
 * A "hook" to access the state management tools (`getState` and `setState`)
 * from within a task that has been wrapped by `withState`.
 *
 * It retrieves the tools from the current context.
 *
 * @template S The type of the state.
 * @param context The context object, retrieved via `getContext()`.
 * @returns The `StateTools` for interacting with the state.
 * @throws {Error} If called outside of a `withState`-enhanced task's execution scope.
 */
export function useState<S>(context: BaseContext): StateTools<S> {
  const tools = (context as any)[STATE_TOOLS_KEY] as StateTools<S> | undefined;
  if (!tools) {
    throw new Error(
      "useState() can only be used within a task wrapped by withState(). " +
        "Ensure withState() is an ancestor enhancer in your workflow.",
    );
  }
  return tools;
}

/**
 * An enhancer that wraps a task to provide it with a private, encapsulated state.
 * The state is initialized when the task begins and is discarded when it ends.
 *
 * This new implementation is a proper enhancer, making it more composable and
 * improving type inference significantly. The wrapped task can access `getState`
 * and `setState` tools via the `useState(getContext())` hook.
 *
 * @template C The context type of the inner task.
 * @template V The input value type for the task.
 * @template R The result type of the inner task.
 * @template S The type of the encapsulated state.
 *
 * @param initialState A value or a function `(initialValue: V) => S` to create the initial state.
 * @param task The `Task` that will be executed with access to the state tools via context.
 * @returns A new `Task<C, V, { result: R; state: S }>` that returns both the task's
 *          result and the final state.
 *
 * @example
 * ```typescript
 * const innerWorkflow = createWorkflow(
 *   tap((_, ctx) => useState<MyState>(ctx).setState(s => ({ ...s, count: s.count + 1 }))),
 *   map((_, ctx) => useState<MyState>(ctx).getState().count)
 * );
 *
 * const statefulWorkflow = withState(
 *   () => ({ count: 0 }),
 *   innerWorkflow
 * );
 *
 * const final = await run(statefulWorkflow, 'initial-input');
 * // final.result is 1
 * // final.state is { count: 1 }
 * ```
 */
export function withState<C extends BaseContext, V, R, S>(
  initialState: S | ((initialValue: V) => S),
  task: Task<C & { [STATE_TOOLS_KEY]: StateTools<S> }, V, R>,
): Task<C, V, { result: R; state: S }> {
  const statefulTaskLogic: Task<C, V, { result: R; state: S }> = async (
    context,
    value,
  ) => {
    // 1. Initialize the state for this specific execution.
    let state: S =
      typeof initialState === "function"
        ? (initialState as (initialValue: V) => S)(value)
        : initialState;

    // 2. Create the state management tools. They operate on the `state` variable in this closure.
    const tools: StateTools<S> = {
      getState: () => state,
      setState: (updater) => {
        state =
          typeof updater === "function"
            ? (updater as (prevState: S) => S)(state)
            : updater;
      },
    };

    // 3. Use `provide` to inject the tools into the context for the inner task.
    // The `provide` function is assumed to be available from './run' or a similar module.
    // We need to import `provide` for this to work. Let's assume it's available.
    // Since this is a utility, it should use the global smart `provide`.
    const { provide } = await import("./run"); // Dynamic import to avoid circular dependency issues at module load time

    const result = await provide(
      { [STATE_TOOLS_KEY]: tools },
      () => task(context as any, value), // The context for the task will be enhanced by `provide`
    );

    // 4. Return the final result and state.
    return { result, state };
  };

  // Set a descriptive name for the enhanced task
  Object.defineProperty(statefulTaskLogic, "name", {
    value: `withState(${task.name || "anonymousTask"})`,
    configurable: true,
  });

  // Propagate the original task's ID for backtracking or identification.
  if (task.__task_id) {
    Object.defineProperty(statefulTaskLogic, "__task_id", {
      value: task.__task_id,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return statefulTaskLogic;
}

// =================================================================
// Section 6: Advanced Scheduling, Batching, and Polling
// =================================================================

export interface ThrottleOptions {
  /** Maximum number of calls allowed within the interval. */
  limit: number;
  /** The time interval in milliseconds. */
  intervalMs: number;
}

/**
 * Creates a throttled version of a task that respects a rate limit.
 * Calls exceeding the limit are queued. Queued calls respect cancellation.
 * The throttling is based on a token bucket-like approach where tokens are refilled periodically.
 *
 * @template C The context type, which must include `scope`.
 * @template V The input value type of the task.
 * @template R The result type of the task.
 * @param task The `Task` to throttle.
 * @param options The throttling configuration.
 * @returns A new `Task` that enforces the specified rate limit.
 *
 * @example
 * ```typescript
 * const throttledApiCall = withThrottle(apiCall, { limit: 5, intervalMs: 1000 });
 * // This task can now be called rapidly, but will only execute 5 times per second.
 * // Excess calls are queued and processed as capacity becomes available.
 * ```
 */
export function withThrottle<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  options: ThrottleOptions,
): Task<C, V, R> {
  const { limit, intervalMs } = options;
  if (limit <= 0 || intervalMs <= 0) {
    throw new Error("Throttle limit and intervalMs must be positive.");
  }

  // Queue for pending calls: { value, resolve, reject, context }
  const callQueue: Array<{
    value: V;
    resolve: (result: R) => void;
    reject: (error: any) => void;
    context: C;
  }> = [];

  let currentTokens = limit;
  let isProcessingQueue = false; // Mutex to prevent concurrent processing of the queue

  // Calculate refill rate: how often to add one token.
  // Ensure refillIntervalTime is at least 1ms to prevent setInterval(0).
  const refillIntervalTime = Math.max(1, intervalMs / limit);
  const refillInterval: ReturnType<typeof setInterval> = setInterval(() => {
    if (currentTokens < limit) {
      currentTokens++;
    }
    processQueue(); // Attempt to process queue whenever a token is refilled
  }, refillIntervalTime);

  // For Node.js, allow the process to exit if this is the only active timer.
  if (typeof refillInterval.unref === "function") {
    refillInterval.unref();
  }

  const processQueue = async () => {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    // Process as many items as there are tokens and queued items
    while (callQueue.length > 0 && currentTokens > 0) {
      const nextCall = callQueue[0]; // Peek, don't shift yet

      if (nextCall.context.scope.signal.aborted) {
        callQueue.shift(); // Remove aborted call
        nextCall.reject(
          nextCall.context.scope.signal.reason ??
            new DOMException("Aborted", "AbortError"),
        );
        continue; // Check next in queue
      }

      currentTokens--; // Consume a token
      callQueue.shift(); // Now remove it from queue

      // Execute the task. Do not await here to allow multiple tasks to run concurrently up to the token limit.
      // The promise resolves/rejects the original Promise returned to the caller of withThrottle.
      task(nextCall.context, nextCall.value)
        .then(nextCall.resolve)
        .catch(nextCall.reject)
        .finally(() => {
          // Although tokens are refilled by setInterval,
          // if tasks complete very quickly, one could argue for immediate token return.
          // However, typical throttle aims to limit start rate, so setInterval refill is standard.
        });
    }
    isProcessingQueue = false;
  };

  const throttledTask: Task<C, V, R> = (context: C, value: V): Promise<R> => {
    return new Promise<R>((resolve, reject) => {
      if (context.scope.signal.aborted) {
        reject(
          context.scope.signal.reason ??
            new DOMException("Aborted", "AbortError"),
        );
        return;
      }

      callQueue.push({ value, resolve, reject, context });
      processQueue(); // Attempt to process immediately if tokens are available
    });
  };

  Object.defineProperty(throttledTask, "name", {
    value: `throttled(${task.name || "anonymous"})`,
    configurable: true,
  });
  if (task.__task_id) {
    throttledTask.__task_id = task.__task_id;
  }
  if (task.__steps) {
    throttledTask.__steps = task.__steps;
  }

  // Note: Consider adding a cleanup function for `clearInterval(refillInterval)`
  // if the throttledTask itself can be "disposed of". For typical usage, it runs for app lifetime.

  return throttledTask;
}

/**
 * Configuration options for the `withPoll` utility.
 * @template R The type of the result produced by the task being polled.
 */
export interface PollOptions<R> {
  /**
   * The interval in milliseconds between polling attempts.
   * Must be non-negative.
   */
  intervalMs: number;
  /**
   * The total duration in milliseconds after which the polling will time out
   * if the `until` condition is not met. Must be non-negative.
   */
  timeoutMs: number;
  /**
   * A predicate function that is called with the result of each polling attempt.
   * Polling stops when this function returns `true`.
   * @param result The result from the polled task.
   * @returns `true` to stop polling, `false` to continue.
   */
  until: (result: R) => boolean | Promise<boolean>; // Allow async predicate
  /**
   * An optional name for the polling operation, used in the PollTimeoutError message.
   * If not provided, the name of the wrapped task will be used.
   */
  pollName?: string;
}

/**
 * Custom error thrown by `withPoll` when the `timeoutMs` is reached before
 * the `until` condition returns true.
 */
export class PollTimeoutError extends GenericTimeoutError {
  // Inherit from a generic TimeoutError if available
  // public override readonly _tag = 'PollTimeoutError' as const;
  constructor(operationName: string, timeoutMs: number) {
    super(
      // `Polling operation '${operationName}' timed out after ${timeoutMs}ms.`
      operationName,
      timeoutMs,
    );
    this.name = "PollTimeoutError"; // Override name
    Object.setPrototypeOf(this, PollTimeoutError.prototype);
  }
}

/**
 * Creates a task that repeatedly executes another `taskToPoll` at a specified
 * `intervalMs` until an `until` condition (a predicate function) returns `true`
 * or an overall `timeoutMs` is reached.
 *
 * The polling mechanism is cancellable via the context's `AbortSignal`.
 * If the `timeoutMs` is reached before the `until` condition is met, a `PollTimeoutError` is thrown.
 *
 * @template C The context type, which must include `scope`.
 * @template V The input value type of the task being polled.
 * @template R The result type of the task being polled (and of this polling task).
 * @param taskToPoll The `Task<C, V, R>` to execute repeatedly.
 * @param options Configuration for the polling behavior (`intervalMs`, `timeoutMs`, `until` predicate).
 * @returns A new `Task<C, V, R>` that implements the polling logic.
 *
 * @example
 * ```typescript
 * const checkJobStatusTask = defineTask(async (ctx, jobId: string) => api.getJob(jobId));
 *
 * const waitForJobCompletion = withPoll(checkJobStatusTask, {
 *   intervalMs: 5000,  // Check every 5 seconds
 *   timeoutMs: 300000, // Timeout after 5 minutes
 *   until: (jobStatus) => jobStatus.isComplete || jobStatus.hasFailed,
 *   pollName: 'JobStatusCheck'
 * });
 *
 * try {
 *   const finalJobStatus = await run(waitForJobCompletion, 'job-123');
 *   // ... process finalJobStatus
 * } catch (error) {
 *   if (error instanceof PollTimeoutError) {
 *     console.error('Job status polling timed out:', error.message);
 *   } else {
 *     // Handle errors from checkJobStatusTask itself if they are not caught internally
 *     console.error('Error during job status check:', error);
 *   }
 * }
 * ```
 */
export function withPoll<C extends BaseContext, V, R>(
  taskToPoll: Task<C, V, R>,
  options: PollOptions<R>,
): Task<C, V, R> {
  const { intervalMs, timeoutMs, until: untilPredicate, pollName } = options;

  if (intervalMs < 0) {
    throw new Error("PollOptions.intervalMs must be non-negative.");
  }
  if (timeoutMs < 0) {
    throw new Error("PollOptions.timeoutMs must be non-negative.");
  }
  // Optional: Could warn if timeoutMs is very small relative to intervalMs,
  // e.g., if timeoutMs < intervalMs, no retry will happen.

  const operationName = pollName || taskToPoll.name || "anonymousPoll";

  const pollingLoopTask: Task<C, V, R> = async (
    context: C,
    value: V,
  ): Promise<R> => {
    // Loop indefinitely until the `until` condition is met or an error (like timeout) is thrown.
    // The overall timeout is handled by `withTimeout` wrapping this loop.
    // Cancellation is handled by `taskToPoll` and `sleep` respecting `context.scope.signal`.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      // Explicit check before potentially long operation (taskToPoll)
      if (context.scope.signal.aborted) {
        throw (
          context.scope.signal.reason ??
          new DOMException(
            "Polling loop aborted before task execution",
            "AbortError",
          )
        );
      }

      const result = await taskToPoll(context, value);

      // Check condition after task execution
      if (await untilPredicate(result)) {
        // Await in case `until` is async
        return result; // Condition met, resolve with the result
      }

      // Explicit check before potentially long operation (sleep)
      if (context.scope.signal.aborted) {
        throw (
          context.scope.signal.reason ??
          new DOMException("Polling loop aborted before sleep", "AbortError")
        );
      }

      // Wait for the specified interval before the next poll attempt.
      // `sleep` is cancellable and will throw if context.scope.signal is aborted.
      await sleep(intervalMs)(context, null);
      // Loop continues for the next attempt.
    }
  };

  // Wrap the pollingLoopTask with the overall timeout mechanism.
  // If withTimeout throws its own TimeoutError, we want to wrap it in PollTimeoutError.
  const timedPollingLoop: Task<C, V, R> = async (context: C, value: V) => {
    try {
      return await withTimeout(pollingLoopTask, timeoutMs)(context, value);
    } catch (error) {
      if (
        error instanceof GenericTimeoutError &&
        !(error instanceof PollTimeoutError)
      ) {
        // Check if it's the generic TimeoutError from withTimeout
        throw new PollTimeoutError(operationName, timeoutMs);
      }
      throw error; // Re-throw other errors (e.g., from taskToPoll, or PollTimeoutError itself)
    }
  };

  // Set descriptive name and propagate properties for the final task
  Object.defineProperty(timedPollingLoop, "name", {
    value: `withPoll(${operationName}, interval=${intervalMs}ms, timeout=${timeoutMs}ms)`,
    configurable: true,
  });

  // Propagate __task_id from the original taskToPoll if it exists.
  // This implies that if backtracking targets taskToPoll, the polling mechanism restarts.
  if (taskToPoll.__task_id) {
    Object.defineProperty(timedPollingLoop, "__task_id", {
      value: taskToPoll.__task_id,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  if (taskToPoll.__steps) {
    // If taskToPoll was a workflow
    Object.defineProperty(timedPollingLoop, "__steps", {
      value: taskToPoll.__steps,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return timedPollingLoop;
}

export interface BatchingOptions {
  /**
   * The time window in milliseconds to wait for collecting keys before dispatching the batch.
   * @default 10
   */
  windowMs?: number;
  /**
   * The maximum number of keys to include in a single batch. If this limit is reached
   * before `windowMs` elapses, the batch will be dispatched immediately.
   * @default Infinity (no limit other than windowMs)
   */
  maxBatchSize?: number;
}

/**
 * Represents an item pending in the batch queue.
 */
interface PendingBatchItem<K, R> {
  key: K;
  resolve: (value: R) => void;
  reject: (reason?: any) => void;
  signal: AbortSignal; // Signal from the context of the individual call
}

/**
 * Creates a task that batches multiple calls for individual keys into a single
 * underlying call to `batchFn`. This is extremely useful for reducing the number
 * of requests to a backend, database, or other I/O-bound service (similar to DataLoader).
 *
 * Calls are collected during a `windowMs` time window or until `maxBatchSize` is reached.
 * Individual calls in the queue respect their context's `AbortSignal`.
 * The `batchFn` itself can be made cancellable by observing the aggregated signal passed to it.
 *
 * @template C The context type. Must include `scope`.
 * @template K The type of the key for each item (e.g., an ID).
 * @template R The type of the result for each key.
 * @param batchFn An asynchronous function that accepts an array of keys (`K[]`),
 *                the parent context (`C`), and an `AbortSignal` for the batch execution.
 *                It must return a `Promise` of an array of results (`R[]`) in the
 *                *same order* as the input keys.
 * @param options Optional configuration for the batching behavior, including `windowMs`
 *                and `maxBatchSize`.
 * @returns A `Task<C, K, R>` that, when called, queues its key and resolves with the
 *          corresponding result from the batched call.
 *
 * @example
 * ```typescript
 * const fetchUsersByIdsBatched = createBatchingTask<AppContext, string, User>(
 *   async (ids, context, batchSignal) => {
 *     // In a real scenario, use batchSignal if your API client supports it
 *     console.log(`[BatchFn] Fetching users for IDs: ${ids.join(', ')} with context`, context.someService);
 *     return UserAPI.getByIds(ids, { signal: batchSignal }); // Assuming API supports signal
 *   },
 *   { windowMs: 20, maxBatchSize: 10 }
 * );
 *
 * // In a workflow:
 * const user1Promise = run(fetchUsersByIdsBatched, 'user-1');
 * const user2Promise = run(fetchUsersByIdsBatched, 'user-2');
 * const [user1, user2] = await Promise.all([user1Promise, user2Promise]);
 * // This would likely result in one call to UserAPI.getByIds(['user-1', 'user-2'])
 * ```
 */
export function createBatchingTask<C extends BaseContext, K, R>(
  batchFn: (keys: K[], context: C, batchSignal: AbortSignal) => Promise<R[]>,
  options: BatchingOptions = {},
): Task<C, K, R> {
  const { windowMs = 10, maxBatchSize = Infinity } = options;

  if (windowMs < 0) {
    throw new Error("BatchingOptions windowMs must be non-negative.");
  }
  if (maxBatchSize <= 0) {
    throw new Error("BatchingOptions maxBatchSize must be positive.");
  }

  let pendingItems: PendingBatchItem<K, R>[] = [];
  let dispatchTimer: ReturnType<typeof setTimeout> | null = null;
  // Use the context of the first call in a batch as the representative context for the batchFn.
  // This is a common approach; alternatively, one could try to merge contexts or require
  // batchFn to not rely on specific request-scoped context values.
  let representativeContextForBatch: C | null = null;

  const dispatch = () => {
    if (dispatchTimer) {
      clearTimeout(dispatchTimer);
      dispatchTimer = null;
    }

    const currentBatchItems = pendingItems;
    const batchContext = representativeContextForBatch; // Use the captured context

    pendingItems = [];
    representativeContextForBatch = null;

    if (currentBatchItems.length === 0 || !batchContext) {
      return;
    }

    // Filter out calls that were aborted while in the queue
    const activeCalls: PendingBatchItem<K, R>[] = [];
    const abortedCalls: PendingBatchItem<K, R>[] = [];

    for (const item of currentBatchItems) {
      if (item.signal.aborted) {
        abortedCalls.push(item);
      } else {
        activeCalls.push(item);
      }
    }

    abortedCalls.forEach((item) =>
      item.reject(
        item.signal.reason ??
          new DOMException("Call aborted before batch dispatch", "AbortError"),
      ),
    );

    if (activeCalls.length === 0) {
      return;
    }

    const keysForBatch = activeCalls.map((item) => item.key);

    // Create an AbortController for the batchFn call itself.
    // This can be aborted if the representativeContextForBatch's scope is aborted.
    // Or, if we had a way to aggregate signals from all activeCalls (complex).
    // For now, link it to the representativeContextForBatch's signal.
    const batchAbortController = new AbortController();
    const onBatchContextAbort = () => {
      batchAbortController.abort(
        batchContext.scope.signal.reason ??
          new DOMException("Batch execution aborted by context", "AbortError"),
      );
    };
    batchContext.scope.signal.addEventListener("abort", onBatchContextAbort, {
      once: true,
    });

    batchFn(keysForBatch, batchContext, batchAbortController.signal)
      .then((results) => {
        if (results.length !== activeCalls.length) {
          // This is a critical error in the batchFn implementation
          const error = new Error(
            `Batch function contract violation: expected ${activeCalls.length} results, but got ${results.length}.`,
          );
          activeCalls.forEach((item) => item.reject(error));
          return;
        }
        activeCalls.forEach((item, i) => item.resolve(results[i]));
      })
      .catch((error) => {
        // If batchFn itself throws, reject all promises in this batch
        activeCalls.forEach((item) => item.reject(error));
      })
      .finally(() => {
        batchContext.scope.signal.removeEventListener(
          "abort",
          onBatchContextAbort,
        );
        // If batchAbortController wasn't aborted by context, ensure it's cleaned up.
        if (!batchAbortController.signal.aborted) {
          batchAbortController.abort(
            new DOMException("Batch function concluded.", "AbortError"),
          );
        }
      });
  };

  const batchingTask: Task<C, K, R> = (context: C, key: K): Promise<R> => {
    // If this call itself is already aborted, reject immediately
    if (context.scope.signal.aborted) {
      return Promise.reject(
        context.scope.signal.reason ??
          new DOMException("Call aborted before queueing", "AbortError"),
      );
    }

    // Capture the context of the first item in a new batch.
    if (!representativeContextForBatch) {
      representativeContextForBatch = context;
    }

    const promise = new Promise<R>((resolve, reject) => {
      pendingItems.push({ key, resolve, reject, signal: context.scope.signal });
    });

    // Clear existing timer if one is pending (i.e., this call arrived before previous window closed)
    if (dispatchTimer) {
      clearTimeout(dispatchTimer);
    }
    // Start a new timer
    dispatchTimer = setTimeout(dispatch, windowMs);

    // If maxBatchSize is reached, dispatch immediately
    if (pendingItems.length >= maxBatchSize) {
      dispatch();
    }

    return promise;
  };

  Object.defineProperty(batchingTask, "name", {
    value: `createBatchingTask(${batchFn.name || "batchFn"})`,
    configurable: true,
  });
  // A batching task usually doesn't have a single __task_id in the same way
  // as a direct task, as it's a queueing mechanism.
  // If needed, a unique Symbol could be assigned.
  // Object.defineProperty(batchingTask, '__task_id', { value: Symbol(...) });

  return batchingTask;
}

export interface DebounceOptions {
  /**
   * If true, the AbortSignal from the latest call's context will be linked
   * to the debounced execution. If the latest call's context is aborted
   * before the debounced function executes, the execution can be cancelled.
   * Note: This means only the *latest* call's signal is respected for cancellation
   * of the pending execution.
   * @default true
   */
  linkToLatestSignal?: boolean;
}

/**
 * Creates a debounced version of a task. The task will only be executed
 * after a specified period of inactivity (`durationMs`) following the last call.
 * All calls made during the debounce window (i.e., before the task executes)
 * will receive the same promise, which resolves or rejects with the result of
 * the single eventual execution.
 *
 * This implements a "trailing edge" debounce.
 *
 * @template C The context type, which must include `scope`.
 * @template V The input value type of the task.
 * @template R The result type of the task.
 * @param task The `Task` to debounce.
 * @param durationMs The debounce duration in milliseconds. Must be non-negative.
 * @param options Optional configuration for the debounce behavior.
 * @returns A new, debounced `Task`.
 *
 * @example
 * ```typescript
 * const debouncedSearch = withDebounce(searchApi, 300);
 * // Can be called rapidly; API call only happens 300ms after the last invocation.
 * run(debouncedSearch, 'query1');
 * run(debouncedSearch, 'query2'); // 'query1' call is superseded, 'query2' will be used.
 * ```
 */
export function withDebounce<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  durationMs: number,
  options?: DebounceOptions,
): Task<C, V, R> {
  if (durationMs < 0) {
    throw new Error("Debounce durationMs must be non-negative.");
  }

  const { linkToLatestSignal = true } = options || {};

  let timerId: ReturnType<typeof setTimeout> | null = null;
  // Stores the promise for the currently pending debounced execution.
  let pendingExecutionPromise: Promise<R> | null = null;
  // Stores the arguments and promise resolvers of the *latest* call that initiated/reset the timer.
  let latestCallPayload: {
    value: V;
    context: C;
    resolve: (value: R) => void;
    reject: (reason?: any) => void;
    abortController?: AbortController; // Controller for linking external signal
  } | null = null;

  const debouncedTaskLogic: Task<C, V, R> = async (
    context: C,
    value: V,
  ): Promise<R> => {
    // If there's an active timer, clear it because a new call has arrived.
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
      // If the previous timer had an abort listener, remove it.
      if (latestCallPayload?.abortController) {
        latestCallPayload.context.scope.signal.removeEventListener(
          "abort",
          latestCallPayload.abortController.abort,
        );
      }
    }

    // If no promise is pending for an execution cycle, create one.
    // This promise will be shared by all calls within this debounce window.
    if (!pendingExecutionPromise) {
      pendingExecutionPromise = new Promise<R>((resolve, reject) => {
        // Store the details from the current (latest) call to be used when the timer fires.
        // This will effectively become the (resolve, reject) for pendingExecutionPromise.
        latestCallPayload = { value, context, resolve, reject };
      });
    } else {
      // A pendingExecutionPromise exists. We update latestCallPayload to reflect this newest call's
      // details (value, context) but keep the original promise's resolve/reject.
      // This means the original promise will resolve with the result of an execution
      // using the *latest* value and context.
      // NOTE: This is a common debounce behavior. If `resolve` and `reject` from previous
      // callers that shared `pendingExecutionPromise` should be ignored, the logic becomes more complex.
      // Typically, all callers to a debounced function get the same eventual result.
      // Here, we update the payload that the timer will use.
      if (latestCallPayload) {
        // Should always be true if pendingExecutionPromise is not null
        latestCallPayload.value = value;
        latestCallPayload.context = context;
        // The resolve/reject functions remain from the call that initiated pendingExecutionPromise
      }
    }

    // Prepare for potential cancellation linked to the latest call's context
    let currentCallAbortController: AbortController | undefined;
    const onLatestCallAbort = () => {
      // If this specific call (which set up the current timer) is aborted,
      // we should clear the timer and reject its associated promise.
      if (
        timerId !== null &&
        latestCallPayload &&
        latestCallPayload.context === context
      ) {
        clearTimeout(timerId);
        timerId = null;
        // Resetting `pendingExecutionPromise` means subsequent calls start a new debounce cycle.
        // The `reject` here is for the `pendingExecutionPromise` that all current waiters are on.
        latestCallPayload.reject(
          context.scope.signal.reason ??
            new DOMException(
              "Debounced execution aborted by latest caller",
              "AbortError",
            ),
        );
        pendingExecutionPromise = null;
        latestCallPayload = null;
      }
    };

    if (linkToLatestSignal) {
      // We only care about the latest signal. If a previous call set up an abort listener,
      // it's already been cleared when its timer was cleared.
      if (latestCallPayload) {
        // latestCallPayload should be set if pendingExecutionPromise is true
        latestCallPayload.abortController = new AbortController(); // Dummy controller for linking
        context.scope.signal.addEventListener("abort", onLatestCallAbort, {
          once: true,
        });
      }
    }

    timerId = setTimeout(() => {
      // Timer fired. Use the details from the latestCallPayload.
      if (latestCallPayload) {
        const {
          value: execValue,
          context: execContext,
          resolve: execResolve,
          reject: execReject,
          abortController,
        } = latestCallPayload;

        // Clean up: remove signal listener, reset timerId
        if (linkToLatestSignal && abortController) {
          execContext.scope.signal.removeEventListener(
            "abort",
            onLatestCallAbort,
          );
        }
        timerId = null;
        // Keep pendingExecutionPromise and latestCallPayload until task resolves/rejects
        // so that new calls arriving *while the task is executing* still get this promise.

        // Before executing, check if the context associated with this execution was aborted *while timer was running*.
        // This check is covered by onLatestCallAbort if linkToLatestSignal is true.
        // If linkToLatestSignal is false, the original task should check its own signal.
        if (linkToLatestSignal && execContext.scope.signal.aborted) {
          execReject(
            execContext.scope.signal.reason ??
              new DOMException(
                "Debounced execution aborted before start",
                "AbortError",
              ),
          );
          pendingExecutionPromise = null; // Allow new debounce cycle
          latestCallPayload = null;
          return;
        }

        task(execContext, execValue)
          .then(execResolve)
          .catch(execReject)
          .finally(() => {
            // After the task completes (success or fail), clear pendingExecutionPromise
            // so the next call to withDebounce will start a new debounce cycle.
            pendingExecutionPromise = null;
            latestCallPayload = null;
          });
      }
    }, durationMs);

    // All calls in the current debounce window return the same pendingExecutionPromise.
    return pendingExecutionPromise;
  };

  const debouncedTask: Task<C, V, R> = debouncedTaskLogic;

  Object.defineProperty(debouncedTask, "name", {
    value: `withDebounce(${task.name || "anonymous"}, ${durationMs}ms)`,
    configurable: true,
  });
  if (task.__task_id) {
    Object.defineProperty(debouncedTask, "__task_id", {
      value: task.__task_id, // Or a new Symbol
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }
  if (task.__steps) {
    Object.defineProperty(debouncedTask, "__steps", {
      value: task.__steps,
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return debouncedTask;
}
