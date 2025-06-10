/**
 * @module
 * This module provides a comprehensive, type-safe, and hierarchical approach
 * to error handling in task-based workflows. It distinguishes between expected
 * domain errors (best handled with `Result` types) and unexpected system panics
 * (best handled with `withErrorBoundary`).
 */

import { type Task, type Scope, defineTask, getContext, isBacktrackSignal } from './run'; // Assuming core types are in './run'
import { Result, ok, err } from 'neverthrow';

// --- Custom Error Creation ---

/**
 * Options for creating a new custom error type.
 */
export interface ErrorTypeOptions {
  /** The name of the error class. This is used in `error.name`. */
  name: string;
  /** An optional parent error class for creating a hierarchy. */
  parent?: new (...args: any[]) => Error;
}

/**
 * A factory function for creating custom, hierarchical error classes.
 * This utility correctly sets up the prototype chain, ensuring that `instanceof`
 * checks work as expected for both the created class and its parents.
 *
 * @param options The configuration for the new error type.
 * @returns A new Error class constructor.
 *
 * @example
 * ```typescript
 * // Create a base error for all database issues.
 * const DatabaseError = createErrorType({ name: 'DatabaseError' });
 *
 * // Create specific errors that inherit from the base error.
 * const ConnectionError = createErrorType({ name: 'ConnectionError', parent: DatabaseError });
 * const QueryError = createErrorType({ name: 'QueryError', parent: DatabaseError });
 *
 * const err = new ConnectionError('Failed to connect');
 * console.log(err instanceof ConnectionError); // true
 * console.log(err instanceof DatabaseError); // true
 * console.log(err instanceof Error); // true
 * ```
 */
export function createErrorType<T extends any[]>(
  options: ErrorTypeOptions
): new (...args: T) => Error {
  const { name, parent = Error } = options;

  // Define a class expression that extends the provided parent.
  // This is the modern, type-safe way to handle inheritance.
  class CustomError extends parent {
    name: string;
    constructor(...args: T) {
      // `super(...args)` correctly calls the parent constructor.
      // This replaces the problematic `parent.apply(this, args)`.
      super(...args);

      // Set the name for identification, which is crucial for debugging.
      this.name = name;

      // Ensure the prototype chain is correctly set up for `instanceof` checks.
      // This is a robust way to handle extending built-in classes like Error.
      Object.setPrototypeOf(this, new.target.prototype);

      // Capture a clean stack trace, omitting our constructor from it.
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, CustomError);
      }
    }
  }

  // Set the display name of the class itself for better debugging.
  Object.defineProperty(CustomError, 'name', { value: name, configurable: true });

  // The created class is a valid constructor matching the return signature.
  return CustomError as new (...args: T) => Error;
}


// --- Error Boundary and Handlers ---

/**
 * A type representing a handler tuple for `withErrorBoundary`.
 * It pairs an error class constructor with a handler function that receives
 * a correctly typed instance of that error.
 */
export type ErrorHandler<C, R> = [
  new (...args: any[]) => Error,
  (error: any, context: C) => R | Promise<R>
];

/**
 * A utility function for creating a type-safe error handler tuple.
 * Using this ensures that the type of the `error` argument in the handler
 * function is correctly inferred from the provided error class.
 *
 * @param ErrorClass The specific error class to handle.
 * @param handlerFn The function to execute when an error of `ErrorClass` is caught.
 * @returns A tuple `[ErrorClass, handlerFn]` for use with `withErrorBoundary`.
 */
export function createErrorHandler<C, R, E extends Error>(
  ErrorClass: new (...args: any[]) => E,
  handlerFn: (error: E, context: C) => R | Promise<R>
): ErrorHandler<C, R> {
  return [ErrorClass, handlerFn];
}

/**
 * A higher-order task that acts as a "safety net" for a workflow. It catches
 * specified thrown errors and delegates them to type-safe handlers. This is
 * the recommended way to handle unexpected system panics.
 *
 * The boundary matches errors hierarchically, both by prototype chain
 * (e.g., a `DatabaseError` handler will catch a `ConnectionError` if it inherits
 * from it) and by the order of handlers provided.
 *
 * @param task The `Task` or workflow to protect.
 * @param handlers An array of `ErrorHandler` tuples, created with `createErrorHandler`.
 *                 The handlers are evaluated in order, so place more specific
 *                 handlers before more general ones.
 * @returns A new `Task` that will not throw if a matching handler is found.
 *          The result of the task will be the original result or the result
 *          from the executed error handler.
 */
export function withErrorBoundary<C extends { scope: Scope }, V, R>(
  task: Task<C, V, R>,
  handlers: ErrorHandler<C, R>[]
): Task<C, V, R> {
  return defineTask(async (value: V) => {
    const context = getContext<C>();
    try {
      return await task(context, value);
    } catch (error) {
      if (isBacktrackSignal(error) || !(error instanceof Error)) {
        throw error;
      }

      for (const [ErrorClass, handlerFn] of handlers) {
        if (error instanceof ErrorClass) {
          return handlerFn(error, context);
        }
      }

      throw error;
    }
  });
}


// --- Result-based Error Handling ---

/**
 * Safely wraps a function that may throw, converting its outcome into a `Result`.
 * This is the ideal tool for creating a safe boundary between your type-safe
 * `Result`-based code and external libraries or legacy functions that throw.
 *
 * @param fn The synchronous or asynchronous function to wrap.
 * @returns A new function that returns a `Promise<Result<T, E>>` and will never throw.
 */
export function tryCatch<T, TArgs extends any[], E extends Error = Error>(
  fn: (...args: TArgs) => T | Promise<T>
): (...args: TArgs) => Promise<Result<T, E>> {
  return async (...args: TArgs): Promise<Result<T, E>> => {
    try {
      const result = await fn(...args);
      return ok(result);
    } catch (error) {
      if (error instanceof Error) {
        return err(error as E);
      }
      return err(new Error(String(error)) as E);
    }
  };
}