# 🤔 Why Effectively? A Pragmatic Approach to Modern Asynchronous TypeScript

Programming is challenging. Building robust, scalable, and maintainable applications requires more than just writing code that works—it requires a clear and principled approach to managing complexity. Effectively presents a new way of thinking about how we structure and compose asynchronous code in TypeScript, one that is both powerful and deeply pragmatic.

The core philosophy of Effectively is simple: **complex asynchronous behaviors should be built by composing simple, focused functions.**

This guide will take you on a journey from tangled, imperative code to clean, declarative, and resilient workflows.

#### The Problem: The Inherent Tangle of Asynchronous Logic

In "typical" TypeScript, without a structured approach, `async` functions often become a tangle of disparate concerns. A single function might be responsible for data fetching, business logic, error handling, retry mechanisms, logging, and cancellation logic. This leads to code that is difficult to read, impossible to test in isolation, and brittle to change.

Consider a common requirement: fetching a user profile from an API, with a few retries in case of transient network issues.

```typescript
// A "typical" async function, full of tangled concerns
const fetchUserProfile = async (userId: string, signal?: AbortSignal): Promise<User> => {
  let attempts = 0;
  while (attempts < 3) {
    try {
      // The core logic: fetching the data
      const response = await fetch(`.../users/${userId}`, { signal });
      if (!response.ok) {
        // Specific error handling logic
        if (response.status === 404) throw new UserNotFoundError();
        throw new NetworkError(`Request failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') throw error; // Cancellation logic
      
      // The retry logic is tangled with everything else
      attempts++;
      if (attempts >= 3) {
        console.error("All retry attempts failed.");
        throw error;
      }
      // The backoff logic
      await new Promise(res => setTimeout(res, 1000 * attempts));
    }
  }
  throw new Error("fetchUserProfile failed: Should not be reached");
};
```
This function, while functional, is a maintenance nightmare. The core business logic is completely obscured by cross-cutting concerns.

#### The Effectively Solution: Composition over Tangling

Effectively provides a clean, declarative way to solve this by separating the core logic from its enhancements.

Let's refactor the same function using the Effectively pattern.

```typescript
import { defineTask, withRetry, getContext } from 'effectively';
import { Result, ok, err } from 'neverthrow';

// 1. Define custom, meaningful error types.
class UserNotFoundError extends Error { /* ... */ }
class NetworkError extends Error { /* ... */ }

// 2. Define the simple, core async operation as a Task.
// Its only job is to fetch data and translate outcomes into a typed Result.
const fetchUserTask = defineTask(
  async (userId: string): Promise<Result<User, UserNotFoundError | NetworkError>> => {
    // It gets the scope and api client from the context automatically.
    const { scope, api } = getContext(); // Dependencies are available via context
    try {
      const response = await api.fetchUser(userId, { signal: scope.signal }); // Cancellation is built-in.
      if (response.status === 404) return err(new UserNotFoundError());
      if (!response.ok) return err(new NetworkError(`Request failed: ${response.status}`));
      return ok(await response.json());
    } catch (e: any) {
      return err(new NetworkError(e.message));
    }
  }
);

// 3. Use Enhancers and composition to declaratively add behavior.
// The result is a new, more powerful Task (a "Workflow").
export const resilientFetchUser = withRetry(fetchUserTask, {
  attempts: 3,
  backoff: 'exponential',
  // Only retry on network errors, not "User not found".
  shouldRetry: (error) => error instanceof NetworkError,
});
```

This version offers significant advantages:
*   **Clean and Readable**: `fetchUserTask` has a single responsibility. The `resilientFetchUser` workflow clearly states its enhanced behavior.
*   **Composable and Reusable**: The `withRetry` enhancer (and others like `withTimeout`, `withCircuitBreaker`, or `bracket` for resource management) can be applied to any Task.
*   **Testable**: `fetchUserTask` can be tested in isolation by providing a mock `api` service in the `Context` during `run`.
*   **Type-Safe**: Using `neverthrow`'s `Result` type (a recommended peer dependency) makes the signature of `fetchUserTask` explicit about potential failure outcomes, enabling compiler checks.

This compositional approach is the heart of Effectively. It encourages you to build small, single-responsibility `Task`s and then wrap them with declarative **Enhancers** to create robust, complex workflows.

```
         ┌─── The core, focused async function
         │           ┌─── A declarative wrapper that adds behavior
         ▼           ▼
Task<Input, Output> + Enhancer  =>  New, more powerful Task
```

### ✨ A Pragmatic Philosophy: Enhancement over Replacement

The TypeScript ecosystem offers several ways to manage asynchronous complexity. Effectively makes a specific, pragmatic choice that sets it apart.

*   **Compared to Raw `async/await`**: Effectively doesn't replace them; it gives them the structure, safety, and composability they often lack in larger applications. It adds "guardrails" and declarative power.

*   **Compared to Full Effect Systems (e.g., `Effect-TS`)**: Libraries like `Effect-TS` are powerful, often replacing `Promise` with their own `Effect` data type and custom runtime (e.g., "Fibers") for fine-grained control. This offers immense power but typically involves a steeper learning curve and a more significant conceptual shift.

**Effectively chooses a different path: enhancement over replacement.**

It is a bet on the long-term power and evolution of the web platform itself. We believe a library should work *with* the grain of the JavaScript environment, not against it. This philosophy has key implications:

1.  **No Custom Runtime:** Effectively uses the standard JavaScript event loop and `Promise` infrastructure. This means less "magic," a potentially smaller bundle, and code that behaves familiarly, debuggable with standard browser tools.
2.  **Leveraging the Platform's Scheduler:** For parallel operations, Effectively aims to use the browser's native **`scheduler.postTask` API** when available (with fallbacks). This allows the browser itself—which has a global view of page activity—to intelligently prioritize tasks (`user-blocking`, `user-visible`, `background`), potentially leading to better overall application performance without custom configuration.
3.  **Modularity and Tree-Shaking:** While the feature set is comprehensive to address real-world needs, the library is designed to be modular. You only include (and bundle) the parts you use.
4.  **Context and DI:** The context system (`getContext`, `createContext`) provides a way to manage dependencies. While it uses an implicit retrieval mechanism (`getContext`), this is designed for convenience in complex workflows and ease of testing through overrides. Core task logic can still be written as pure functions that are then wrapped by `defineTask`.
5.  **Optional Advanced Features:** Patterns like `do-notation` (using generators) are available for those who find them beneficial for specific types of sequential monadic composition, but they are not required to use the library's core strengths.

By embracing `Promise`, `async/await`, and emerging browser APIs, Effectively aims to provide a gentle learning curve and seamless interoperability with the broader Promise-based ecosystem. It seeks to offer a powerful and pragmatic choice for teams looking to bring more structure and resilience to their TypeScript applications.

