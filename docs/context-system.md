# The Smart Context System: A Comprehensive Guide

Effectively features a sophisticated yet simple context system designed to manage dependencies and state in your asynchronous workflows. This guide provides a comprehensive overview of its features, from the simple "smart" functions that work out-of-the-box to advanced patterns for type safety and performance.

## Core Philosophy: Progressive Enhancement

The context system is built on the principle of **progressive enhancement**. You can start with zero configuration and gradually introduce more structure and type safety as your application grows.

1.  **Start Simple:** Use global "smart" functions. They work immediately without any setup.
2.  **Add Structure:** When you need specific dependencies (like a database client or logger), create a custom, typed context with `createContext`.
3.  **Enforce Boundaries:** For library code or critical sections, use "local-only" functions to guarantee a specific context is present.
4.  **Optimize:** For performance-critical code, use `provideWithProxy` to avoid overhead.

This guide will walk you through each of these layers.

## 1. Smart Functions: The Easiest Way to Start

Smart functions are the default exports and provide the most convenient experience. They automatically detect the current execution context. If one is active (from `createContext().run(...)`), they use it. If not, they seamlessly fall back to a minimal, shared **global context**.

This means your tasks will *just work*, whether run in isolation or within a complex application.

### API Reference: Smart Functions

| Function                        | Behavior                                                                                                                                     |
| :------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineTask<C,V,R>(fn)`         | Defines a portable `Task` that can run in any context. Use the `C` generic for type-checking inside the task. See the note on type safety below. |
| `getContext<C>()`               | Gets the current context if active, otherwise returns the global default. **Never throws.**                                                     |
| `getContextSafe<C>()`           | Returns `Ok(context)`. **Never fails.**                                                                                                        |
| `getContextOrUndefined<C>()`    | Returns the current or global context. **Always returns a context object.**                                                                    |
| `run(...)`                      | Executes a task, creating a new scope that inherits from the current context or the global default.                                          |
| `provide(...)`                  | Temporarily adds or overrides properties on the current (or global) context for the duration of a function's execution using object spreading.   |
| `provideWithProxy(...)`         | A high-performance version of `provide` that uses a JavaScript `Proxy` to avoid creating new objects. (See Advanced section).                     |

### Example: From Zero to Structured

```typescript
import { defineTask, getContext, run, createContext } from '@doeixd/effectively';

//--- Phase 1: No setup needed ---
// This task uses smart functions and works immediately.
const greetingTask = defineTask(async (name: string) => {
  // `getContext` safely falls back to the global context here.
  const context = getContext<{ greeting?: string }>();
  const greeting = context.greeting || 'Hello';
  return `${greeting}, ${name}!`;
});

// `run` uses the global context. No `createContext` was needed.
const message = await run(greetingTask, 'World'); // -> "Hello, World!"

//--- Phase 2: Introducing a custom context ---
// Create tools for a specific, typed context.
const { run: customRun } = createContext({ greeting: 'Welcome' });

// The exact same `greetingTask` can be run with the new context.
// `getContext` inside the task will now detect and use this custom context.
const customMessage = await customRun(greetingTask, 'developer'); // -> "Welcome, developer!"
```

## 2. Context-Bound Functions: For Maximum Type Safety

When you have a well-defined application with a consistent set of dependencies, using `createContext<C>()` gives you a set of **context-bound tools**. These tools are permanently tied to your specific context type `C`, providing maximum type safety and editor autocompletion.

### Characteristics

-   **Type-Safe:** All tools know the exact shape of your context `C`.
-   **Local & Strict:** The `getContext()` function from these tools **will throw a `ContextNotFoundError`** if called outside of its corresponding `run()` or `provide()` scope. It never falls back to the global context.

### API Reference: Context-Bound Tools from `createContext<C>()`

| Function                      | Behavior                                                                                                             |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------- |
| `run(...)`                    | Executes a task exclusively within the `C` context.                                                                  |
| `defineTask(...)`             | Creates a `Task` that is strongly typed to expect context `C`.                                                       |
| `getContext()`                | Gets the currently active context of type `C`. **Throws `ContextNotFoundError` if not in an active scope.**            |
| `getContextSafe()`            | Returns `Ok(C)` if in a scope, otherwise `Err(ContextNotFoundError)`.                                                |
| `getContextOrUndefined()`     | Returns the context `C` if in a scope, otherwise `undefined`.                                                        |
| `provide(...)`                | Temporarily modifies the `C` context for a nested scope.                                                             |
| `inject(token)`               | Injects a dependency from the `C` context using a type-safe token. **Throws if not found.**                            |
| `injectOptional(token)`       | Safely injects a dependency from the `C` context, returning `undefined` if not found.                                |

### Usage Example

```typescript
import { createContext, type Scope } from '@doeixd/effectively';

// 1. Define your application's context interface.
interface AppContext extends BaseContext {
  scope: Scope;
  db: { query: (sql: string) => Promise<any> };
  logger: Console;
}

// 2. Create the context-bound tools with default dependencies.
const { defineTask, getContext, run } = createContext<AppContext>({
  db: myDatabaseClient,
  logger: console,
});

// 3. Define a task using these tools.
const fetchUserTask = defineTask(async (userId: string) => {
  const ctx = getContext(); // TypeScript knows `ctx` is of type `AppContext`.
  ctx.logger.info(`Fetching user: ${userId}`);
  return await ctx.db.query(`SELECT * FROM users WHERE id = ${userId}`);
});

// 4. Run the workflow.
const user = await run(fetchUserTask, 'user-123');
```

## 3. Local-Only and Global-Only Functions: For Explicit Control

For advanced use cases or library authors, `Effectively` provides function variants that remove ambiguity by being either strictly local or strictly global.

### Local-Only Functions

These functions enforce that a specific context *must* be active. They are ideal for library code that has explicit context requirements.

| Function                          | Behavior                                                                          |
| :-------------------------------- | :-------------------------------------------------------------------------------- |
| `defineTaskLocal<C,V,R>(fn)`      | Creates a `Task`. **Throws `ContextNotFoundError` if no specific context is active.** |
| `getContextLocal<C>()`            | Gets the current specific context. **Throws `ContextNotFoundError` if none exists.** |
| `getContextSafeLocal<C>()`        | Returns `Err(ContextNotFoundError)` if no specific context is active.               |
| `getContextOrUndefinedLocal<C>()` | Returns `undefined` if no specific context is active.                               |
| `runLocal(...)`                   | Executes a task only if a specific context is active. **Throws if not.**            |
| `provideLocal(...)`               | Modifies only the active specific context. **Throws if none exists.**               |

### Global-Only Functions

These functions *always* operate on the global default context, ignoring any active specific context. They are useful for creating globally consistent utilities.

| Function                     | Behavior                                                               |
| :--------------------------- | :--------------------------------------------------------------------- |
| `defineTaskGlobal<V,R>(fn)`  | Creates a `Task` that always uses the global context.                    |
| `getContextGlobal()`         | Always gets the global default context.                                |
| `runGlobal(...)`             | Always executes a task in the global default context.                    |
| `provideGlobal(...)`         | Always modifies the global default context.                              |

---

## Advanced Patterns & Concepts

### High-Performance Context Overrides with `provideWithProxy`

The standard `provide` function works by creating a new context object for each call using object spreading (`{ ...parentContext, ...overrides }`). While simple and effective, this can create performance overhead in hot code paths or with very large context objects due to repeated object creation and garbage collection.

For these high-performance scenarios, `Effectively` offers `provideWithProxy`.

```typescript
import { provideWithProxy } from 'effectively';

await provideWithProxy({ logger: mockLogger }, async () => {
  // Code here runs with the mocked logger, but no new context object was cloned.
});
```

**How it Works:**

Instead of creating a new object, `provideWithProxy` uses a JavaScript `Proxy` to wrap the parent context. This proxy intercepts property lookups, returning a value from the `overrides` if it exists, and otherwise forwarding the request to the parent context.

**Benefits:**

-   **Zero-Copy Overrides:** No new context object is created, drastically reducing memory allocation.
-   **Faster Execution:** Bypassing object spread makes `provideWithProxy` significantly faster for frequent, nested calls.

**When to Use It:**

-   Inside tight loops or recursive tasks that modify context.
-   When your application context is very large.
-   In any performance-critical section of your application where context switching is common.

For most general use cases, the standard `provide` is sufficient, but `provideWithProxy` is a powerful tool for optimization.

### A Note on Global `defineTask` and Type Safety

When using the global `defineTask`, you can provide a context type hint like `defineTask<MyContext, ...>`. It's important to understand what this does:

-   **It provides design-time type checking** for calls to `getContext<MyContext>()` *inside* your task's function body.
-   **It does NOT change the returned Task's signature.** The global `defineTask` always returns a `Task<any, ...>`, making it portable enough to run in any context.

This means the type hint is a contract *you* make with the compiler, asserting that this task is intended to be run in a context compatible with `MyContext`. It's a powerful feature for writing flexible, yet type-aware, tasks.

---

## Troubleshooting Guide

### Understanding `ContextNotFoundError`

It is crucial to understand which context functions can fail.

❌ **The following functions WILL throw a `ContextNotFoundError`** if called outside of an active `run` or `provide` scope:
-   `getContextLocal()`
-   The context-bound `getContext()` returned from `createContext<C>()`.

✅ **The following "smart" global functions WILL NOT throw `ContextNotFoundError`**. They are designed to always succeed by falling back to a minimal global default context if no specific context is active:
-   `getContext()`
-   `getContextSafe()` (will always return an `Ok` result)
-   `getContextOrUndefined()` (will always return a context object)

This behavior makes the smart global functions safe to use at the top level, while the local-only functions provide a strict guarantee that a specific context must be present.

### Final Comparison

| Function Family     | Source                 | Behavior                                   | When to Use                                    |
| :------------------ | :--------------------- | :----------------------------------------- | :--------------------------------------------- |
| **Smart**           | `import {...}`         | Current context or global fallback.        | General application code, maximum flexibility.   |
| **Context-Bound**   | `createContext<C>()`   | Local to a specific context `C`. Throws if not active. | App development with a well-defined context. |
| **Local-Only**      | `import {...Local}`    | Current context only. Throws if not active.      | Library code or enforcing strict boundaries.     |
| **Global-Only**     | `import {...Global}`   | Always uses the global default context.    | Globally consistent utilities or services.       |