# A Deep Dive into Scope, Context, and Cancellation

In any real-world application, operations can fail, dependencies are complex, and resources must be managed carefully. This guide explores the heart of how "Effectively" solves these challenges through its integrated **Scope** and **Context** system.

Mastering these concepts will allow you to write complex, resilient, and leak-proof asynchronous applications with confidence.

### The Core Idea: The "Job" Analogy

Think of running a workflow as starting a **Job**. To do this job, your code needs two things:

| Concept         | Analogy              | Purpose                                                                                                        |
| :-------------- | :------------------- | :------------------------------------------------------------------------------------------------------------- |
| **`Context`**   | **The Toolbox**      | A "bag" of dependencies your tasks need to do their work, like a database client, a logger, or an API key.        |
| **`Scope`**     | **The Supervisor**   | An object *inside* the context that manages the **lifecycle** of the job. It knows when the job starts and when it must stop. |

Every time you call `run()`, you are starting a new Job with a fresh Supervisor (`Scope`) and a set of Tools (`Context`).

## Part 1: How Do I Make My Code Cancellable? (Using `Scope`)

The `Scope` is the cornerstone of resilience. It's how you make long-running operations responsive to user actions, timeouts, and errors.

### What is a `Scope`?

Every context contains a `scope` object. Its most important property is `signal`, which is a standard web [`AbortSignal`](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal).

```typescript
interface Scope {
  readonly signal: AbortSignal;
}
```

By embracing this platform-native primitive, your cancellable tasks are instantly interoperable with `fetch`, modern timers, and many third-party libraries.

### Making Your Tasks Cancellable

Your tasks can access the current scope through the context.

#### Example 1: Cancelling `fetch` Requests (The Easy Way)

The most common use case is passing the `signal` directly to a `fetch` request.

```typescript
import { defineTask, getContext } from 'effectively';

const fetchCancellable = defineTask(async (url: string) => {
  // 1. Get the current context, which contains the scope.
  const { scope } = getContext();

  try {
    // 2. Pass the signal directly to fetch. The browser handles the rest.
    const response = await fetch(url, { signal: scope.signal });
    return response.json();
  } catch (error: any) {
    // 3. The fetch promise will reject with an AbortError if cancelled.
    if (error.name === 'AbortError') {
      console.log('Fetch was successfully cancelled!');
    }
    throw error;
  }
});
```

#### Example 2: Manual Checks in Long-Running Loops

For long computations or loops, you should periodically check if the scope has been cancelled.

```typescript
const processLargeDataset = defineTask(async (items: any[]) => {
  const { scope } = getContext();

  for (const item of items) {
    // Check the signal before starting each piece of work.
    if (scope.signal.aborted) {
      console.log('Loop aborted, stopping processing.');
      throw new DOMException('Processing aborted by user.', 'AbortError');
    }
    await processSingleItem(item);
  }
});
```

### How is a Workflow Cancelled?

A workflow's scope is aborted in three main ways:

1.  **External `AbortSignal` (Most Common):** Pass a `parentSignal` to the `run` function. This is the primary way for external systems (like a UI component unmounting) to cancel a workflow.

    ```typescript
    const controller = new AbortController();
    run(longRunningTask, null, { parentSignal: controller.signal });

    // Later, you can cancel the job from anywhere.
    controller.abort();
    ```

2.  **Internal Unhandled Error:** If a task throws an error, `run()` automatically aborts the scope to ensure any pending parallel tasks are also cancelled, preventing orphaned operations.

3.  **Timeout Enhancers:** Utilities like `withTimeout` work by racing your task against a timer that aborts the workflow's scope if it doesn't complete in time.

---

## Part 2: How Do I Manage Dependencies? (Using `Context`)

If the `Scope` is the *lifecycle*, the `Context` is the *environment*. It holds all the "tools" your tasks need.

### The Hierarchy: How Context is Created

The context system is designed to be predictable, operating on a clear principle of inheritance.

| Level                 | How It's Created                                | Key Characteristic                                                              |
| :-------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------ |
| **Global Context**    | Exists automatically.                           | The root of everything. A minimal fallback with just a `scope`.                 |
| **App Context**       | `createContext<AppContext>({...})`              | A typed "template" for your application's specific dependencies and defaults.   |
| **Execution Context** | Every time you call `run(...)`.                 | An **ephemeral clone** of its parent (App or Global), plus any `overrides`. |

This creates a predictable data flow:

```mermaid
graph TD
    A[Global Context<br>{ scope }] --> B{run()};
    B --> C[Execution Context 1<br>{ scope, ...overrides }];
    C --> D{Task A};
    D -- calls --> E{run(subTask)};
    E --> F[Execution Context 2<br>{ scope, (inherited props) }];
    F --> G{subTask};
```

**The Golden Rule of Context:**
> When `run` is called, it **clones its parent's context**, applies `overrides`, and **replaces the `scope`** with a brand new one for the new job.

This rule ensures dependencies flow down, but lifecycles remain isolated.

## Part 3: How Do I Change Context on the Fly? (Using `provide`)

Sometimes, you need to temporarily add or change a dependency for a small part of your workflow. This is what `provide` is for. It's perfect for mocking dependencies in tests or setting request-specific values like a trace ID.

### `provide`: The Standard Approach

The default `provide` function works just like `run`: it creates a new context for the code inside it by **cloning the current context** and applying overrides.

```typescript
import { provide, getContext, defineTask, run } from 'effectively';

const myTask = defineTask(async () => {
  const ctx = getContext<{ api_key: string }>();
  // This will use the temporary key inside the provide block.
  console.log(`Using API Key: ${ctx.api_key}`);
});

await provide(
  { api_key: 'temporary-test-key' },
  async () => {
    // Any task run inside this block will have the overridden context.
    await run(myTask, undefined);
  }
);
```

While simple, this cloning can have a performance cost.

### `provideWithProxy`: The High-Performance Option

For performance-critical scenarios, `Effectively` offers a powerful alternative: `provideWithProxy`.

**How it Works:** Instead of cloning, `provideWithProxy` wraps the parent context in a JavaScript `Proxy`. This creates a "virtual" context that looks for properties in your `overrides` first, and if not found, it looks in the parent. This **zero-copy override** mechanism is significantly faster and uses less memory.

```typescript
import { provideWithProxy } from 'effectively';

await provideWithProxy({ logger: mockLogger }, async () => {
  // Code here runs with the mocked logger, but no new context object was cloned.
});
```

**When to Use It:**
-   ✅ Inside tight loops or recursive tasks that modify context.
-   ✅ When your application context is very large.
-   ✅ In any performance-critical section where context switching is common.

For most use cases, `provide` is fine, but `provideWithProxy` is your go-to tool for optimization.

## Part 4: How Do I Avoid Magic Strings? (Dependency Injection)

Accessing dependencies via `getContext().myDb` works, but it can be brittle. For a more robust, type-safe approach, `Effectively` supports dependency injection using tokens.

This pattern decouples your tasks from the concrete implementation of their dependencies, making your code more modular, testable, and easier to refactor.

### The Three Steps to Dependency Injection

#### 1. Create a Token
A token is a unique, typed key for your dependency.

```typescript
// src/tokens.ts
import { createInjectionToken } from 'effectively';

// Define a type for your service.
interface IDatabase {
  query: (sql: string) => Promise<any[]>;
}

// Create a token associated with that type.
export const DbToken = createInjectionToken<IDatabase>('DatabaseService');
```

#### 2. Inject the Dependency in Your Task
Use `inject(token)` to retrieve the dependency in a type-safe way.

```typescript
// src/tasks.ts
import { DbToken } from './tokens';
import { defineTask, inject } from 'effectively';

const getUserTask = defineTask(async (id: string) => {
  // Type-safe access: `db` is guaranteed to be of type `IDatabase`.
  const db = inject(DbToken);
  return db.query(`SELECT * FROM users WHERE id = '${id}'`);
});
```
*(Use `injectOptional(token)` if the dependency might not be present.)*

#### 3. Provide the Implementation at Runtime
Use `provide` or `run`'s `overrides` to supply the concrete implementation for the token. This is where you connect the abstract token to a real object.

```typescript
// main.ts (Production)
import { DbToken } from './tokens';
import { myDbClient } from './db';

await run(getUserTask, '123', { overrides: { [DbToken]: myDbClient } });


// test.ts (Testing)
import { DbToken } from './tokens';
import { myMockDb } from './mocks';

test('fetches a user', async () => {
  await run(getUserTask, '123', { overrides: { [DbToken]: myMockDb } });
  // ... your assertions ...
});
```