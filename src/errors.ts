/**
 * @module
 * This module provides a comprehensive, type-safe, and hierarchical approach
 * to error handling in task-based workflows. It distinguishes between expected
 * domain errors (best handled with `Result` types) and unexpected system panics
 * (best handled with `withErrorBoundary`).
 */

import {
  type Task,
  type Scope, // Assuming Scope is part of BaseContext if not directly used
  type BaseContext,
  // defineTask, // Not directly used by these utilities themselves
  // getContext, // Not directly used by these utilities themselves
  isBacktrackSignal,
} from './run'; // Assuming core types are in './run'
import { Result, ok, err } from 'neverthrow';

// =================================================================
// Section 1: Custom Error Creation
// =================================================================

/**
 * Options for creating a new custom error type.
 */
export interface ErrorTypeOptions {
  /** The name of the error class. This is used in `error.name`. */
  name: string;
  /** An optional parent error class for creating a hierarchy. Defaults to `Error`. */
  parent?: new (...args: any[]) => Error;
}

/**
 * A factory function for creating custom, hierarchical error classes.
 * This utility correctly sets up the prototype chain, ensuring that `instanceof`
 * checks work as expected for both the created class and its parents.
 * The created error will have a constructor that accepts any arguments and passes
 * them to the parent constructor.
 *
 * @template TConstructorArgs An array type representing the arguments accepted by the constructor of the custom error.
 * @param options The configuration for the new error type, including its name and optional parent.
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
 * // Usage:
 * try {
 *   throw new ConnectionError('Failed to connect to database.', { cause: originalNetworkError });
 * } catch (e) {
 *   if (e instanceof ConnectionError) {
 *     console.error('Connection issue:', e.message, e.cause);
 *   }
 *   if (e instanceof DatabaseError) {
 *     console.error('Database problem detected.');
 *   }
 * }
 * ```
 */
export function createErrorType<TConstructorArgs extends any[] = [message?: string, options?: ErrorOptions]>(
  options: ErrorTypeOptions
): new (...args: TConstructorArgs) => Error { // Return type is a constructor
  const { name: errorName, parent: ParentErrorClass = Error } = options;

  class CustomError extends ParentErrorClass {
    name: string;
    constructor(...args: TConstructorArgs) {
      // Call the parent constructor with the provided arguments.
      // This works correctly even if the parent is `Error` (which takes message/options)
      // or another custom error with a different constructor signature.
      super(...(args as any[])); // Cast args to any[] for super, TConstructorArgs ensures call site is typed

      // Set the name for identification, crucial for debugging and `error.name`.
      this.name = errorName;

      // Standard practice for custom errors extending built-ins like Error,
      // to ensure `instanceof` works correctly and the prototype chain is right.
      Object.setPrototypeOf(this, new.target.prototype);

      // Capture a cleaner stack trace by omitting this constructor from it, if available.
      if (Error.captureStackTrace) {
        Error.captureStackTrace(this, CustomError);
      }
    }
  }

  // Set the display name of the class itself (the constructor function's name).
  // This helps in debugging and some reflection scenarios.
  Object.defineProperty(CustomError, 'name', { value: errorName, configurable: true });

  // The created class is a valid constructor.
  return CustomError as new (...args: TConstructorArgs) => Error;
}


// =================================================================
// Section 2: Error Boundary and Handlers
// =================================================================

/**
 * A type representing a handler tuple for `withErrorBoundary`.
 * It pairs an error class constructor (`ErrorConstructor`) with a handler function
 * that receives a correctly typed instance of that error (`E`) and the context.
 * The handler should return a value of type `R` (or `Promise<R>`), which is the
 * expected result type of the task being protected.
 *
 * @template C The context type.
 * @template R The result type of the handler (and the task).
 * @template E The specific type of Error this handler deals with.
 */
export type ErrorHandlerTuple<C, R, E extends Error> = [
  new (...args: any[]) => E, // The specific Error class constructor
  (error: E, context: C) => R | Promise<R> // Handler for that specific error type
];

/**
 * An array of ErrorHandlerTuple, allowing for multiple types of errors to be handled.
 * The `any` for the error type in the handler function within the array definition
 * is a concession for heterogeneous arrays; `createErrorHandler` ensures type safety
 * when creating individual tuples.
 */
export type ErrorHandlerArray<C, R> = Array<[
  new (...args: any[]) => Error, // General Error constructor for the array
  (error: any, context: C) => R | Promise<R> // Handler with `any` error for array compatibility
]>;


/**
 * A utility function for creating a type-safe error handler tuple.
 * Using this ensures that the type of the `error` argument in the handler
 * function is correctly inferred from the provided error class constructor.
 *
 * @template C The context type.
 * @template R The result type that the handler must return (matching the protected task's result type).
 * @template E The specific type of `Error` this handler is for.
 * @param ErrorClass The constructor of the specific error class (e.g., `MyCustomError`).
 * @param handlerFn The function to execute when an error of `ErrorClass` is caught.
 *                  It receives the typed error instance and the current context.
 * @returns A tuple `[ErrorClass, handlerFn]` for use with `withErrorBoundary`'s `handlers` array.
 */
export function createErrorHandler<C, R, E extends Error>(
  ErrorClass: new (...args: any[]) => E,
  handlerFn: (error: E, context: C) => R | Promise<R>
): ErrorHandlerTuple<C, R, E> {
  return [ErrorClass, handlerFn];
}

/**
 * A higher-order task that acts as a "safety net" for a workflow or task.
 * It catches specified thrown errors (that are instances of `Error`) and delegates
 * them to type-safe handlers. This is the recommended way to handle unexpected
 * system panics or specific operational errors you want to recover from.
 *
 * The boundary matches errors hierarchically using `instanceof`. The provided
 * `handlers` array is evaluated in order, so more specific error handlers
 * should typically be placed before more general ones if their types overlap.
 *
 * If an error is caught and a matching handler is found, the handler's result
 * is returned. If no handler matches, or if the caught item is not an `Error`
 * instance (or is a `BacktrackSignal`), the error is re-thrown.
 *
 * @template C The context type, which must include `scope`.
 * @template V The input value type of the task.
 * @template R The result type of the task (and the error handlers).
 * @param task The `Task<C, V, R>` or workflow to protect.
 * @param handlers An array of `ErrorHandlerTuple` (ideally created with `createErrorHandler`)
 *                 defining which errors to catch and how to handle them.
 * @returns A new `Task<C, V, R>` that incorporates the error boundary logic.
 */
export function withErrorBoundary<C extends BaseContext, V, R>(
  task: Task<C, V, R>,
  handlers: ErrorHandlerArray<C, R> // Use the broader type for the array
): Task<C, V, R> {
  const errorBoundaryTask: Task<C, V, R> = async (context: C, value: V): Promise<R> => {
    try {
      return await task(context, value);
    } catch (error) {
      // Do not handle BacktrackSignals or things that are not actual Error instances.
      if (isBacktrackSignal(error) || !(error instanceof Error)) {
        throw error;
      }

      // Iterate through handlers to find a match.
      for (const handlerTuple of handlers) {
        const ErrorClass = handlerTuple[0]; // Constructor
        const handlerFn = handlerTuple[1];  // Handler function (error: any, context: C) => ...

        if (error instanceof ErrorClass) {
          // `error` is now narrowed to an instance of `ErrorClass`.
          // The `handlerFn` from `createErrorHandler` is expecting this specific type.
          // We cast `handlerFn` here to satisfy TypeScript, knowing `createErrorHandler`
          // ensures the internal `handlerFn` is correctly typed.
          // Or, more robustly, the ErrorHandlerArray would store ErrorHandlerTuple<C,R,SpecificError>
          // but that makes array creation complex. This approach is common.
          return (handlerFn as (e: typeof error, context: C) => R | Promise<R>)(error, context);
        }
      }

      // If no handler matched, re-throw the original error.
      throw error;
    }
  };

  Object.defineProperty(errorBoundaryTask, 'name', {
    value: `withErrorBoundary(${task.name || 'anonymousTask'})`,
    configurable: true,
  });
  // Propagate __task_id and __steps if they exist, for consistency with other enhancers
  // and to ensure the wrapped task can still be identified or its structure understood.
  if (task.__task_id) {
    Object.defineProperty(errorBoundaryTask, '__task_id', {
      value: task.__task_id, // Or a new Symbol if it should be a distinct step
      configurable: true, enumerable: false, writable: false,
    });
  }
  if (task.__steps) {
    Object.defineProperty(errorBoundaryTask, '__steps', {
      value: task.__steps,
      configurable: true, enumerable: false, writable: false,
    });
  }

  return errorBoundaryTask;
}


// =================================================================
// Section 3: Result-based Error Handling Utility (`tryCatch`)
// =================================================================

/**
 * Default error mapper for `tryCatch` when the caught item is not an `Error` instance,
 * or when a generic `Error` needs to be cast to a more specific `E`.
 */
function defaultErrorMapper<E extends Error>(caughtError: unknown): E {
  if (caughtError instanceof Error) {
    // If E is a specific subtype of Error, this cast assumes compatibility.
    // The user can provide a custom mapErrorToE for more complex mappings.
    return caughtError as E;
  }
  // For non-Error types, wrap them in a generic Error instance.
  return new Error(String(caughtError !== undefined ? caughtError : 'Unknown error')) as E;
}

/**
 * Safely wraps a function (synchronous or asynchronous) that may throw,
 * converting its outcome into a `Promise<Result<T, E>>`. This utility ensures
 * that the returned function will never throw directly but will always yield
 * a `Result` object, capturing either the successful value (`Ok<T>`) or the
 * error (`Err<E>`).
 *
 * This is ideal for creating a safe boundary between type-safe `Result`-based
 * code and external libraries or legacy functions that rely on throwing exceptions.
 *
 * @template T The expected type of the successful result of `fn`.
 * @template TArgs The types of the arguments accepted by `fn`.
 * @template E The expected type of the error if `fn` throws (must extend `Error`).
 *               Defaults to `Error`.
 * @param fn The synchronous or asynchronous function to wrap.
 * @param mapErrorToE An optional function to map a caught `unknown` error value
 *                    to the desired error type `E`. If not provided, a default
 *                    mapper is used which attempts to cast `Error` instances or
 *                    wraps non-`Error` values in a new `Error`.
 * @returns A new asynchronous function that takes the same arguments as `fn` but
 *          returns a `Promise<Result<T, E>>` and will not throw.
 *
 * @example
 * ```typescript
 * const riskyJsonParse = (jsonString: string): object => JSON.parse(jsonString); // Throws SyntaxError
 * const safeJsonParse = tryCatch(riskyJsonParse);
 *
 * const result1 = await safeJsonParse('{"foo":"bar"}'); // Ok({ foo: "bar" })
 * const result2 = await safeJsonParse('invalid json');   // Err(SyntaxError(...))
 *
 * if (result2.isErr()) {
 *   console.error("Parsing failed:", result2.error.message);
 * }
 * ```
 */
export function tryCatch<T, TArgs extends any[], E extends Error = Error>(
  fn: (...args: TArgs) => T | Promise<T>,
  mapErrorToE: (caughtError: unknown) => E = defaultErrorMapper
): (...args: TArgs) => Promise<Result<T, E>> {
  return async (...args: TArgs): Promise<Result<T, E>> => {
    try {
      const result = await fn(...args);
      return ok(result);
    } catch (error) {
      return err(mapErrorToE(error));
    }
  };
}