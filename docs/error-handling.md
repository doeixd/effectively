### A Guide to Resilient Error Handling in Effectively

In any real-world application, things go wrong. Networks fail, APIs return errors, and unexpected bugs occur. A robust application is not one that never fails, but one that handles failure gracefully, predictably, and safely.

Effectively provides a powerful, multi-layered strategy for error handling, allowing you to choose the right tool for the job. This guide covers the full spectrum, from handling predictable failures with compile-time safety to catching unexpected panics with a resilient safety net.

#### The Core Philosophy: Two Types of Errors

To handle errors effectively, we must first classify them. This distinction is the most important concept in this guide.

1.  **Domain Errors (Expected Failures):** These are a normal, predictable part of your application's business logic. They represent alternative, non-success paths, not system faults.
    *   **Examples:** A user not being found in a database (`404 Not Found`), a submitted form failing validation (`400 Bad Request`), or a user not having permission to access a resource (`403 Forbidden`).
    *   **Guiding Principle:** These are not exceptions to the flow; they are an expected part of it. They should be handled **as values**, making them part of your function's explicit return type.

2.  **System Panics (Unexpected Failures):** These are true exceptional circumstances that indicate a problem with the system itself, from which your immediate business logic often cannot recover.
    *   **Examples:** The database being disconnected, running out of memory, a third-party library throwing a `TypeError`, or a bug in your code causing a null reference error.
    *   **Guiding Principle:** These are truly exceptional. They should be allowed to **throw** and be caught by a higher-level "safety net" or boundary that can manage the failure at an application level.

Effectively provides distinct, best-in-class solutions for both.

### Part 1: Handling Domain Errors with the `Result` Pattern

The most common source of bugs in asynchronous TypeScript is the untyped nature of `Promise.reject()` and `throw`. A `Promise` can reject with any value, forcing you into defensive `instanceof` checks and leaving you vulnerable to runtime errors.

The solution is to **stop throwing domain errors**. Instead, we treat them as first-class return values using a `Result` type, for which Effectively is designed to pair perfectly with the `neverthrow` library.

#### Step 1: Create Custom, Hierarchical Error Types

Before you can handle domain errors as values, you need to name them. The `createErrorType` utility allows you to define a clean, modern hierarchy of custom error classes.

```typescript
// src/errors.ts
import { createErrorType } from 'effectively/errors';

// 1. Create a base error for a category of issues.
export const DatabaseError = createErrorType({ name: 'DatabaseError' });

// 2. Create specific errors that inherit from the base error.
export const ConnectionError = createErrorType({ name: 'ConnectionError', parent: DatabaseError });
export const QueryError = createErrorType({ name: 'QueryError', parent: DatabaseError });

const err = new ConnectionError('Failed to connect');
console.log(err instanceof ConnectionError); // true
console.log(err instanceof DatabaseError);  // true, thanks to correct inheritance
```

#### Step 2: Design Tasks to Return a `Result`

Refactor your core I/O and business logic tasks to return a `Promise<Result<TSuccess, TError>>` instead of throwing domain errors.

```typescript
// src/tasks/user-tasks.ts
import { defineTask, getContext } from 'effectively';
import { ok, err, Result } from 'neverthrow';
import { UserNotFoundError, NetworkError } from '../errors';

const fetchUser = defineTask(
  async (userId: string): Promise<Result<User, UserNotFoundError | NetworkError>> => {
    const { api, scope } = getContext();
    try {
      const response = await api.fetchUser(userId, { signal: scope.signal });
      
      // Instead of throwing, return a typed Err value.
      if (response.status === 404) {
        return err(new UserNotFoundError(userId));
      }
      if (!response.ok) {
        return err(new NetworkError(`API Error: ${response.status}`));
      }
      
      // Instead of returning the value directly, wrap it in Ok.
      return ok(await response.json());
    } catch (e) {
      // Also catch unexpected exceptions and wrap them.
      return err(new NetworkError(e.message));
    }
  }
);
```
The signature `Promise<Result<User, UserNotFoundError | NetworkError>>` is now a machine-verified contract.

#### Step 3: Handle the Final `Result`

At the end of your workflow, `run` will return the final `Result`. Use the type-safe `.match()` method (from `neverthrow`) to handle both outcomes. The TypeScript compiler will ensure you've handled every possible error type defined in your `Result`.

```typescript
const finalResult = await run(fetchUser, 'user-123');

finalResult.match(
  // The success path. `user` is correctly typed as `User`.
  (user) => console.log(`Welcome, ${user.name}!`),
  
  // The failure path. `error` is typed as `UserNotFoundError | NetworkError`.
  (error) => {
    if (error instanceof UserNotFoundError) {
      console.log(`User ${error.userId} could not be found.`);
    } else if (error instanceof NetworkError) {
      console.error('A network error occurred while fetching the user.');
    }
  }
);
```

This pattern eradicates an entire class of runtime errors by turning them into compile-time checks.

### Part 2: Handling System Panics with `withErrorBoundary`

Sometimes, an error is truly exceptional and cannot be handled by the immediate business logic. For these "panics," we need a higher-level safety net. The `withErrorBoundary` utility acts like a `try/catch` block for an entire workflow, preventing panics from crashing your application.

#### The Type-Safe `createErrorHandler`

To use `withErrorBoundary`, you create handlers with the `createErrorHandler` utility. This simple factory function creates a handler tuple `[ErrorClass, handlerFn]` and ensures the `error` argument inside your handler is correctly typed, eliminating the need for manual `instanceof` checks.

```typescript
import { createErrorHandler } from 'effectively/errors';
import { DatabaseError } from '../errors';

const myHandler = createErrorHandler(DatabaseError, (error, context) => {
  // `error` is guaranteed to be an instance of `DatabaseError`.
  context.logger.error('Database panic!', { cause: error.cause });
  return 'fallback_value'; // The handler can recover by returning a value.
});
```

#### Hierarchical Catching

The boundary is powerful because it matches errors in two hierarchical ways:

1.  **Prototype Chain Hierarchy (Inheritance):** It matches handlers not just on the exact error class, but also on its parent classes. This allows you to catch broad categories of errors (e.g., all `DatabaseErrors`) with a single handler.
2.  **Handler Order (Specificity):** The handlers in the array are checked in order. You should always place more specific handlers before more general ones.

#### Example: A Multi-Layered Strategy

Let's build a robust order processing workflow using custom errors and an error boundary.

```typescript
import { withErrorBoundary } from 'effectively/errors';
import { createErrorHandler, createErrorType } from 'effectively/errors';
import { DatabaseError, QueryError, ConnectionError, PaymentGatewayError } from '../errors';

// 1. Create type-safe error handlers.
const handleQueryError = createErrorHandler(QueryError, (e) => {
  console.error("Failed to generate invoice, will retry later.", e);
  return { invoiceState: 'pending_generation' }; // Recover with a fallback state.
});

const handleDatabaseError = createErrorHandler(DatabaseError, (e, ctx) => {
  ctx.metrics.increment('database_panics');
  return 'Order processing is temporarily unavailable.'; // User-friendly message.
});

const handleAllOtherErrors = createErrorHandler(Error, (e, ctx) => {
  ctx.metrics.increment('unhandled_panics');
  return 'An unexpected error occurred. Our team has been notified.';
});

// 2. Compose the workflow with the boundary.
const createOrderWorkflow = defineTask(async () => { /* might throw ConnectionError */ });
const chargeAndInvoiceWorkflow = defineTask(async () => { /* might throw PaymentGatewayError or QueryError */ });

// The top-level workflow has a comprehensive safety net.
const safeOrderWorkflow = withErrorBoundary(
  pipe(createOrderWorkflow, chargeAndInvoiceWorkflow), // pipe is used to chain tasks
  [
    // The handlers are ordered by specificity.
    handleQueryError,       // Most specific.
    handleDatabaseError,    // Catches ConnectionError and any other DatabaseError.
    handleAllOtherErrors,   // Catches PaymentGatewayError and everything else.
  ]
);
```

### Part 3: Bridging the Worlds with `tryCatch`

What if you need to use a third-party library or legacy function that still `throws`? The `tryCatch` utility is your bridge. It safely wraps a function that may throw and converts its outcome into a `Result`, allowing you to integrate it safely into your `Result`-based workflows.

```typescript
import { tryCatch } from 'effectively/errors';

// `JSON.parse` is a classic function that throws.
const safeJsonParse = tryCatch((text: string) => JSON.parse(text));

// Now it returns a Result and will never throw.
const result = await safeJsonParse('{ "invalid" json }');

if (result.isErr()) {
  // `result.error` is a typed `Error` instance.
  console.error('Failed to parse JSON:', result.error.message);
}
```

### The Complete Strategy: A Summary

By combining these patterns, you create a comprehensive and robust error handling strategy:

1.  **For All Domain Errors, Use the `Result` Pattern.** This is your default. Design your tasks to return `Result` types. Use `tryCatch` at the "edges" of your system to safely interact with external libraries. This gives you compile-time safety for all predictable failure paths.

2.  **For All System Panics, Use `withErrorBoundary`.** Let system-level errors `throw`. Wrap your major workflows in an `withErrorBoundary` with type-safe handlers. This creates a resilient safety net that prevents crashes, logs critical failures, and allows your application to degrade gracefully.

This dual approach gives you the best of both worlds: **compile-time safety for the known and resilient, hierarchical fault tolerance for the unknown.**