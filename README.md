# Effectively 🚂

A structured, type-safe, and extensible toolkit for building modern asynchronous applications in TypeScript. Effectively brings clarity and resilience to your code without sacrificing the natural feel of `async/await`.

![npm](https://img.shields.io/npm/v/effectively?style=for-the-badge) ![license](https://img.shields.io/npm/l/effectively?style=for-the-badge) ![types](https://img.shields.io/npm/types/effectively?style=for-the-badge)

Effectively is the pragmatic middle ground between the chaos of raw `async/await` and the steep learning curve of complex functional effect systems. It's a toolkit designed to feel like a natural extension of the TypeScript language, not a replacement for it.

### ✨ Key Features

*   **🧱 Composable Workflows**: Build complex logic from small, reusable `Task`s using a clean and readable `pipe` operator.
*   **🛡️ Production-Grade Error Handling**: A dual-strategy approach that gives you compile-time safety for expected domain errors and a resilient "safety net" for unexpected system panics.
*   **🔌 Pluggable Dependencies**: A clear context system for dependency injection, making your code modular and incredibly easy to test.
*   **🚀 Powerful Concurrency**: Go beyond `Promise.all` with structured concurrency (`forkJoin`), parallel data processing (`mapReduce`), and advanced schedulers that use browser-native APIs when available.
*   **💼 Guaranteed Resource Safety**: The `bracket` pattern ensures resources like database connections or file handles are *always* cleaned up, even when errors occur.
*   **🧵 Seamless Multi-Threading**: Offload heavy computations to Web Workers without the headache, with robust data serialization and zero-latency cancellation built-in.
*   **🔧 Rich Utility Belt**: Includes production-ready enhancers for retries, timeouts, circuit breakers, debouncing, and more.

---

### 🤔 Why Effectively? A Real-World Comparison

Let's compare three ways to write the same logic: fetch a "todo" item with retries, a timeout, and tracing.

#### The Vanilla `async/await` Version
*(Tangled, imperative, and brittle. The core logic is buried.)*
```typescript
async function getTodoVanilla(id: number, signal?: AbortSignal) {
  const tracer = Otel.trace.getTracer("todos-api");
  return tracer.startActiveSpan("getTodo", { attributes: { id } }, async (span) => {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const timeoutPromise = new Promise((_, reject) => { /* ... */ });
        const fetchPromise = (async () => {
          const response = await fetch(`/todos/${id}`, { signal });
          if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
          return await response.json();
        })();
        const result = await Promise.race([fetchPromise, timeoutPromise]);
        span.setStatus({ code: Otel.SpanStatusCode.OK });
        return result;
      } catch (error) {
        lastError = error;
        if (attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 100 * 2 ** attempt));
      } finally {
        // Complex logic: when do you end the span?
      }
    }
    span.setStatus({ code: Otel.SpanStatusCode.ERROR, message: lastError!.message });
    span.end();
    throw lastError;
  });
}
```

#### The Effectively Version
*(Declarative power with an idiomatic TypeScript feel)*
```typescript
// Each piece of logic is a self-contained, testable enhancer.
export const getTodo = pipe(
  fetchTodoTask,
  withRetry({ maxAttempts: 3, backoff: 'exponential' }),
  withTimeout(1000),
  withSpan('getTodo', (todoId) => ({ id: todoId }))
);
```
Effectively lets you build complex, resilient operations by composing simple, single-responsibility pieces, resulting in code that is easier to read, test, and maintain.

---

### 🧠 The Lifecycle of a Workflow: The Core Mental Model

Mastering Effectively means understanding how its pieces fit together to bring your logic to life.

**1. `Task`: The Building Block**
A **Task** is the smallest unit of work—a simple async function representing one logical step.
`const fetchUser = defineTask(async (id: string) => { /* ... */ });`

**2. `pipe`: The Composer**
You compose tasks into a **Workflow** using `pipe`. It creates a clean, readable sequence where the output of one task becomes the input of the next. `pipe` is like writing a recipe.
`const userWorkflow = pipe(validateId, fetchUser, processUser);`
```
            validateId         fetchUser          processUser
      ID ────────────────> User Object ──────────> Processed Result
```

**3. `run`: The Executor**
A workflow defined with `pipe` is just a blueprint. The **run** function brings it to life. It takes your workflow, gives it an initial value, and executes it. `run` is like cooking the recipe.

**4. `Context` & `Scope`: The Environment**
When `run` executes a workflow, it provides an **Environment**:
*   **Context**: Your dependency injection container (`api`, `logger`, etc.), available via `getContext()`.
*   **Scope**: A cancellation context providing a standard `AbortSignal`.

```
+-------------------------------------------------------------+
| run(userWorkflow, 'user-123')                               |
|   [Context: { api, logger }] [Scope: AbortSignal]           |
|                                                             |
|     +---------------------------------------------------+   |
|     | pipe(validateId, fetchUser, processUser)          |   |
|     |       │              │               │            |   |
|     |       └─> accesses ───┴─> accesses ───┴─> accesses |   |
|     |             Context & Scope                       |   |
|     +---------------------------------------------------+   |
|                                                             |
| ──────────────────> Returns Final Result ──────────────────> |
+-------------------------------------------------------------+
```
---

### 📦 Installation

```bash
npm install effectively neverthrow
```
*`neverthrow` is a peer dependency strongly recommended for our typed error handling patterns.*

---

### 🚀 Quick Start: A Simple, Happy Path

Let's build a basic workflow. We'll show the simplest case here and add robust error handling later.

```typescript
import { createContext, defineTask, pipe, run, getContext } from 'effectively';

interface AppContext {
  scope: Scope;
  api: { fetchUser: (id: string) => Promise<{ name: string }> };
}

const { run, defineTask } = createContext<AppContext>({
  api: { fetchUser: async (id) => ({ name: 'Jane Doe' }) }
});

const fetchUser = defineTask(async (id: string) => {
  const { api } = getContext();
  return api.fetchUser(id);
});

const formatGreeting = defineTask(async (user: { name: string }) => `Hello, ${user.name}!`);
const createGreetingWorkflow = pipe(fetchUser, formatGreeting);

async function main() {
  const greeting = await run(createGreetingWorkflow, 'user-123');
  console.log(greeting); // "Hello, Jane Doe!"
}
main();
```

---

### 📚 Further Reading & Deep Dives

*   **[📄 A Guide to Resilient Error Handling](./docs/error-handling.md)**
*   **[📄 Guaranteed Resource Safety with the Bracket Pattern](./docs/bracket-resource-management.md)**
*   **[📄 Advanced Parallel & Concurrent Task Execution](./docs/parallel.md)**

---

### 🆚 Effectively vs. Effect-TS: A Philosophical Choice

`Effect-TS` is a landmark library that provides a powerful, purely functional approach to building applications. Both Effectively and `Effect-TS` aim to bring structure and safety to asynchronous code, but they do so with fundamentally different philosophies.

| Feature | **Effectively** | **Effect-TS** |
| :--- | :--- | :--- |
| **Core Abstraction**| `Task` (a typed `Promise`-returning function) | `Effect` (a lazy, descriptive data structure) |
| **Execution Model**| **Enhancement:** Uses the native JS event loop & `Promise` | **Replacement:** Provides its own cooperative, fiber-based runtime |
| **Error Handling**| `Result` for domain errors, `try/catch` for panics | Typed error channel (`Effect<E, A>`) for all failures |
| **Learning Curve**| Low; builds on `async/await` and promises | Steep; requires learning a new functional paradigm |

#### Core Difference: Lazy `Effect` vs. Eager `Task`

*   In **`Effect-TS`**, an `Effect` is a **data structure**—a lazy description of a workflow. It doesn't do anything until you pass it to the `Effect` runtime to be executed. This is incredibly powerful because the runtime can analyze, optimize, and precisely control every step.

*   In **Effectively**, a `Task` is an **async function**. It is a standard, `Promise`-returning function that will execute when called. Effectively focuses on *composing* these functions, not on replacing the underlying execution model.

**Advantage (`Effect-TS`):** Unparalleled power and control. The runtime can manage concurrency with lightweight "Fibers" and provides automatic, fine-grained interruption.
**Advantage (Effectively):** Simplicity and familiarity. If you understand `async/await`, you understand how a `Task` runs.

#### Choosing the Right Tool

*   **Choose `Effect-TS` when:** Your team is fully bought into functional programming and you need the absolute maximum level of control and type-safety for a highly complex concurrent application.
*   **Choose Effectively when:** You want to bring structure, resilience, and testability to a standard TypeScript application **without leaving the native `Promise` and `async/await` ecosystem.**

---

### ⚠️ Limitations & Troubleshooting

This section covers common gotchas and design limitations to help you avoid pitfalls.

*   **"I'm getting a `ContextNotFoundError`."**
    This happens when `getContext()` is called outside the scope of a `run` execution. **Solution:** Always call `getContext()` *inside* the body of a `Task`.

*   **"Enhancers like `withRetry` don't seem to be working."**
    Enhancers are **immutable**. They return a *new, enhanced task* and do not modify the original. **Solution:** Always use the return value of an enhancer, preferably by composing it in a `pipe` chain.

*   **"My `Task` seems to execute immediately."**
    This occurs if you execute an async function *before* defining the task. A `Promise` is eager; a `Task` is lazy. **Solution:** Wrap the function call itself inside the `defineTask` closure to defer its execution (e.g., `defineTask(() => myApiCall())`).

*   **Worker Thread Limitations**
    Even with `seroval`, only **serializable data** can be passed in the context to a worker. You cannot pass live connections or other non-serializable objects. Use isomorphic references (`createReference`) for functions.

---

### 🧰 Complete API Reference

#### Core Engine
| Function | Description |
| :--- | :--- |
| `createContext<C>(defaults)` | Creates a new, isolated system with its own `run`, `getContext`, etc. |
| `run<V, R>(task, value, options?)` | Executes a workflow `Task`. The heart of the library. |
| `defineTask<V, R>(fn)` | Defines a function as a `Task`, the fundamental unit of work. |
| `getContext()` | Retrieves the current workflow's context. Must be called within `run`. |
| `provide(overrides, fn)` | Executes a function with a temporarily modified context. Perfect for tests. |

#### Composition & Utilities
| Function | Pattern | Description |
| :--- | :--- | :--- |
| `pipe`| Standalone | Chains tasks together into a single, sequential workflow. |
| `map`| Pipeable | Transforms the value in a workflow using a mapping function. |
| `flatMap`| Pipeable | Transforms the value into a new `Task`. Also known as `chain`. |
| `tap`| Pipeable | Performs a side effect (like logging) but passes the value through. |
| `fromValue`| Standalone | Starts a workflow with a static, known value. |
| `withRetry`| Enhancer | Wraps a task with automatic, cancellable retry logic. |
| `withTimeout`| Enhancer | Wraps a task with a timeout, throwing an error if it's exceeded. |
| `withDebounce`| Enhancer | Wraps a task to ensure it only runs after a period of inactivity. |

#### Error Handling
| Function | Description |
| :--- | :--- |
| `withErrorBoundary`| Wraps a task in a "safety net" to catch and handle thrown errors. |
| `createErrorHandler`| Creates a type-safe handler tuple for use with `withErrorBoundary`. |
| `createErrorType`| A factory for creating custom, hierarchical error classes. |
| `tryCatch`| Safely wraps a function that may throw, converting its outcome into a `Result`. |

#### Resource Management
| Function | Description |
| :--- | :--- |
| `bracket`| Manages a resource's lifecycle, guaranteeing cleanup via an acquire-use-release pattern. |
| `bracketDisposable`| A `bracket` variant for resources implementing `Symbol.dispose` or `Symbol.asyncDispose`. |
| `bracketMany`| Manages the lifecycle of multiple resources at once, releasing in reverse order. |

#### Resilience
| Function | Description |
| :--- | :--- |
| `withCircuitBreaker`| Wraps a task to prevent cascading failures by "tripping" after a failure threshold. |

#### Concurrency & Data Processing
| Function | Pattern | Description |
| :--- | :--- | :--- |
| `forkJoin`| Pipeable | Runs parallel tasks and joins results into a keyed object. |
| `allTuple`| Standalone | Runs parallel tasks and returns a typed tuple of results. |
| `ift`| Pipeable | Provides conditional if-then-else branching for workflows. |
| `mapReduce`| Standalone | A parallel map over a collection followed by a sequential reduce. |
| `all`| Standalone | The core utility for running an array of tasks in parallel. |
| `stream`| Standalone | Processes an iterable of tasks concurrently in a memory-efficient stream. |

#### Effect Handlers
| Function | Description |
| :--- | :--- |
| `defineEffect`| Defines a typed, named placeholder for an action (e.g., logging). |
| `HANDLERS_KEY`| A `Symbol` used to provide handler implementations in the context. |

#### Multi-Threading
| Function | Description |
| :--- | :--- |
| `createWorkerHandler`| **Worker-Side:** Sets up your worker script to handle jobs from the main thread. |
| `runOnWorker`| **Main-Side:** Creates a `Task` that executes its logic on a worker (request-response). |
| `runStreamOnWorker`| **Main-Side:** Creates a `Task` that returns an `AsyncIterable` of results from a worker. |

---

### 🤝 Contributing

Contributions are welcome! Please feel free to open an issue or submit a Pull Request.

### 📄 License

MIT