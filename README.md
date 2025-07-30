![npm](https://img.shields.io/npm/v/@doeixd/effectively)
![license](https://img.shields.io/npm/l/@doeixd/effectively)
# Effectively 🚂

**Build resilient TypeScript applications without the complexity.**

Effectively is a lightweight toolkit that brings structure and safety to asynchronous TypeScript code. It feels like a natural extension of `async/await`, not a replacement for it.

<br />

## 🎯 Why Effectively?

**The Problem:** Modern TypeScript applications face real challenges:
- Unhandled errors crash production systems
- Dependency injection becomes a tangled mess
- Testing async code requires extensive mocking
- Resource leaks from unclosed connections
- No standard patterns for retries, timeouts, or circuit breakers

**The Solution:** Effectively provides simple patterns for these problems without forcing you to learn a new programming paradigm. If you can write `async/await`, you can use Effectively. [See more](docs/why-effectively.md)

<br />

## 📑 Table of Contents

- [📦 Installation](#-installation)
- [🚀 Building Intuition: A Getting Started Guide](#-building-intuition-a-getting-started-guide)
- [💡 Core Concepts](#-core-concepts)
- [🛡️ Error Handling: A Dual Strategy](#️-error-handling-a-dual-strategy)
- [🚀 Features](#-features)
- [🔧 Common Patterns](#-common-patterns)
- [🧪 Testing Your Workflows](#-testing-your-workflows)
- [🤔 Comparisons & Where It Fits](#-comparisons--where-it-fits)
- [🧠 Advanced Concepts](#-advanced-concepts)
- [📚 Guides & Deeper Dives](#-guides--deeper-dives)
- [📋 Best Practices](#-best-practices)
- [⚠️ Common Pitfalls & Solutions](#️-common-pitfalls--solutions)
- [🧰 API Reference](#-api-reference)

<br />

## 📦 Installation

```bash
npm install @doeixd/effectively neverthrow
```

*Note: We highly recommend using `neverthrow` for typed error handling, it integrates well with effectively.*

<br />

## 🚀 Building Intuition: A Getting Started Guide

At its heart, Effectively is intuitively simple. Let's build your understanding from the ground up.

#### Step 1: A Task is Just an Async Function

In Effectively, everything starts with a simple idea: a **Task** is just an async function that a `context` as its first parameter, followed by any input arguments it needs."

```typescript
interface AppContext {
  greeting: string;
}

// This is a Task - just a regular async function!
async function greetTask(context: AppContext, name: string): Promise<string> {
  return `${context.greeting}, ${name}!`;
}

// You could call it directly (but you won't need to)
const message = await greetTask({ greeting: 'Hello' }, 'World');
```

This is the fundamental building block. It's just a function, making it easy to understand and test in isolation.


#### Step 2: `defineTask` Makes Context Implicit

Writing `context` as the first parameter every time is tedious. `defineTask` is a simple helper that makes the context implicit and accessible via a `getContext()` function.

**The Simple Way (No Setup Needed):**
```typescript
import { defineTask, getContext, run } from '@doeixd/effectively';

// No context creation needed! Smart functions use a global default.
const greet = defineTask(async (name: string) => {
  const context = getContext();  // Gets global default context
  return `Hello, ${name}!`;
});

await run(greet, 'World'); // Just works!
```

**The Custom Way (When You Need Specific Dependencies):**
```typescript
import { createContext, type Scope } from '@doeixd/effectively';

// Define your context interface first
interface AppContext {
  scope: Scope;  // Required by the library but better solution exists
  greeting: string;
}

const { defineTask, getContext } = createContext<AppContext>({
  greeting: 'Hello'
});

// After: defineTask makes context implicit
const greet = defineTask(async (name: string) => {
  const { greeting } = getContext();  // Typesafe Context is now available via getContext()
  return `${greeting}, ${name}!`;
});

await run(greet, "World");
```

**The Smart Way (Best of Both Worlds):**
```typescript
import { defineTask, getContext, run, type BaseContext } from '@doeixd/effectively';

interface CustomContext extends BaseContext { // The BaseContext type automatically includes the necessary scope property, solving this boilerplate for you.
  greeting?: string;
}

// This task works in ANY context - it adapts automatically!
const smartGreet = defineTask(async (name: string) => {
  const context = getContext<CustomContext>(); // Smart: uses current context or global default
  const greeting = context.greeting || 'Hello';
  return `${greeting}, ${name}!`;
});

// Works with global context
await run(smartGreet, 'World');

// Also works within custom contexts
const { run: customRun } = createContext({ greeting: 'Hi' });
await customRun(smartGreet, 'World'); // Uses custom greeting
```

That's it! **`defineTask` doesn't do anything magical**—it just wraps your function to handle the context parameter for you, making your code cleaner. The smart context system means you can start simple and add complexity only when needed.


#### Step 3: Workflows Chain Tasks Together

Once you have tasks, you can chain them together using `createWorkflow`. The output of one task becomes the input to the next.

```typescript
interface User {
  id: string;
  name: string;
}

interface EnrichedUser extends User {
  profile: { title: string };
}

const fetchUser = defineTask(async (userId: string) => {
  const { api } = getContext();
  return api.getUser(userId);
});

const enrichUser = defineTask(async (user: User) => {
  const { api } = getContext();
  const profile = await api.getProfile(user.id);
  return { ...user, profile };
});

// A plain async function can also be a step in a workflow.
// Effectively will automatically "lift" it into a Task for you.
async function formatUser(enrichedUser: EnrichedUser): Promise<string> {
  return `${enrichedUser.name} (${enrichedUser.profile.title})`;
}

// Chain them together into a workflow
const getUserDisplay = createWorkflow(
  fetchUser,
  enrichUser,
  formatUser
);
// This creates a new, single Task that runs all three in sequence.

// 💥 this will fail because the context is missing. continue to a next step.
await run(getUserDisplay, "123");
```


#### Step 4: `run` Provides the Context

Tasks need a context to execute. The `run` function, created by `createContext`, provides it.

```typescript
import { createContext, type Scope } from '@doeixd/effectively';

interface ApiClient {
  getUser: (userId: string) => Promise<User>;
  getProfile: (userId: string) => Promise<{ title: string }>;
}

// Define your context interface (scope is required)
interface AppContext {
  scope: Scope;  // Required by the library
  greeting: string;
  api: ApiClient;
}

// dummy implementation of the API client
const myApiClient: ApiClient = {
  getUser: async (userId: string) => ({ id: userId, name: "John Doe" }),
  getProfile: async (userId: string) => ({ title: "Developer" }),
};

// Create your app's context with default dependencies
const { run } = createContext<AppContext>({
  greeting: 'Hello',
  api: myApiClient
});

// Run a single task
const message = await run(greet, 'World');

// Run a workflow (which is also just a Task!)
const display = await run(getUserDisplay, 'user-123');
```

### Step 5: Effect Handlers

Here's where Effectively gets powerful: you can build **algebraic(ish) effect handlers** on top of the context system. These allow you to define abstract effects (like "get user input" or "log a message") and provide different implementations in different contexts.

At its most fundamental level, you can manage this with the raw context system:

```typescript
// Define an effect interface
interface Effects {
  input: (prompt: string) => Promise<string>;
  log: (message: string) => Promise<void>;
}

// A task that uses effects abstractly by pulling them from the context
const greetUser = defineTask(async () => {
  const { input, log } = getContext<AppContext & Effects>();

  const name = await input("What's your name?");
  const greeting = `Hello, ${name}!`;
  await log(greeting);
  return greeting;
});

// Provide different implementations for different contexts
const webEffects: Effects = {
  input: (prompt) => Promise.resolve(window.prompt(prompt) || ''),
  log: (msg) => { console.log(msg); return Promise.resolve(); }
};

const testEffects: Effects = {
  input: (prompt) => Promise.resolve('Test User'),
  log: (msg) => Promise.resolve() // Silent in tests
};

// Use with different effect implementations
await run(greetUser, undefined, { overrides: webEffects });    // Web version
await run(greetUser, undefined, { overrides: testEffects });  // Test version
```

This raw approach works, but for convenience, Effectively provides a **dedicated effects system** that adds better structure, type safety, and error handling.

#### A Dedicated System for Effects

This system lets you formally define effects as callable placeholders.

**1. Define the "what"** using `defineEffect`. This creates a function that, when called, will look for its implementation in the context.

```typescript
import { defineEffect, withHandlers, run } from '@doeixd/effectively';

// Define effects - the "what" without the "how"
const log = defineEffect<(message: string) => void>('log');
const input = defineEffect<(prompt: string) => string>('input');

// A task that uses the effects directly
const greetUser = defineTask(async () => {
  const name = await input("What's your name?");
  const greeting = `Hello, ${name}!`;
  await log(greeting);
  return greeting;
});
```

**2. Provide the "how"** using `withHandlers`. This helper correctly places your handler implementations into the context where the effects can find them.

```typescript
// Provide different implementations for different contexts
const webHandlers = {
  input: (prompt: string) => window.prompt(prompt) || '',
  log: (msg: string) => console.log(msg)
};

const testHandlers = {
  input: (prompt: string) => 'Test User',
  log: (msg: string) => {} // Silent in tests
};

// Use with different effect implementations
await run(greetUser, undefined, withHandlers(webHandlers)); // Web version
await run(greetUser, undefined, withHandlers(testHandlers)); // Test version
```

For applications with multiple effects, you can manage them with the `defineEffects` and `createHandlers` helpers. This is where you can also add a layer of **opt-in type safety**.

```typescript
import { defineEffects, createHandlers, withHandlers, run } from '@doeixd/effectively';

// 1. Define all your effects at once from a single type contract
type AppEffects = {
  log: (message: string) => void;
  getUniqueId: () => string;
  readFile: (path: string) => string,
}
const effects = defineEffects<AppEffects>();

// 2. Create a handlers object
const handlers = createHandlers({
  log: console.log,
  getUniqueId: () => crypto.randomUUID(),
  readFile: (path) => fs.readFileSync(path, 'utf8'),
});

// 3. To ensure safety, you can provide the contract type to `withHandlers`.
//    This lets TypeScript validate that your handlers match the contract.
await run(myTask, input, withHandlers<AppEffects>(handlers));
```

#### The Challenge: Ensuring Safety Across Your App

While adding `<AppEffects>` to `withHandlers` is a great way to add safety, it's a manual step. You have to remember to do it for every `run` call. In a large application, it's easy to forget, re-introducing the risk that your effect definitions and handler implementations could drift out of sync. A typo or a missing handler might not be caught by the compiler.

#### The Recommended Solution: createEffectSuite

To solve this and provide permanent, end-to-end type safety, the library includes the **`createEffectSuite`** factory.

It creates a single, unified toolkit where your effects and handlers are **always** linked to the same contract.

```typescript
import { createEffectSuite, defineTask, run } from '@doeixd/effectively';

// 1. Define the contract, just like before.
type AppEffects = {
  log: (message: string) => void;
  getUniqueId: () => string;
};

// 2. Create the suite. This is the key step.
const { effects, createHandlers, withHandlers } = createEffectSuite<AppEffects>();

// 3. The task definition is identical.
const myTask = defineTask(async () => {
  const id = await effects.getUniqueId();
  await effects.log(`Task run with ID: ${id}`);
});

// 4. Create handlers using the suite's `createHandlers`.
//    ✅ It's impossible to make a mistake here. If a handler is missing
//       or has a typo, you will get a COMPILE-TIME ERROR.
const myHandlers = createHandlers({
  log: console.log,
  getUniqueId: () => 'test-id-123',
});

// 5. Run the task using the suite's `withHandlers`.
//    This is also validated against the contract automatically.
await run(myTask, undefined, withHandlers(myHandlers));
```

This simple, layered approach—from plain async functions to composable workflows with a robust and automatically safe effects system—is the core of Effectively.

<br />


## 💡 Core Concepts

Now that you have the intuition, let's formalize the key concepts:

### 1. Tasks: Your Building Blocks

A **Task** is the atomic unit of work. As you've seen, it's an async function made composable by `defineTask`. This makes dependencies explicit and your code testable.

### 2. Workflows: Composition Made Simple

A **Workflow** chains Tasks together. `createWorkflow` creates a new Task where the output of one becomes the input of the next.

**Visual Flow:**
`CardInput → [validateCard] → ValidCard → [chargeCard] → ChargeResult → [sendReceipt] → Receipt`

### 3. Context: Smart Dependency Injection

**Context** provides your dependencies (like API clients, loggers, or config) without prop drilling or global state. Effectively now features a **smart context system** with three variants:

- **Smart functions** (`getContext`, `defineTask`, `run`): Automatically use the current context if available, otherwise fall back to a global default context
- **Local-only functions** (`getContextLocal`, `defineTaskLocal`, `runLocal`): Only work within an active context, throwing errors if none exists
- **Global-only functions** (`getContextGlobal`, `defineTaskGlobal`, `runGlobal`): Always use the global default context, ignoring any current context

This allows you to start simple (no context creation needed) and progressively enhance your application with custom contexts as needed.

### 4. Effect Handlers and Brackets

**Effect Handlers** enable algebraic effects through the context system, allowing you to write code that's abstract over side effects. **[Brackets](docs/bracket-resource-management.md)** provide guaranteed resource cleanup using the acquire-use-release pattern, ensuring resources are properly disposed of even when errors occur. [See more](docs/bracket-resource-management.md)

### 5. Scope and Cancellation

**Scope** manages the lifecycle of operations and enables cancellation. When a scope is cancelled, all tasks running within that scope receive cancellation signals, allowing for graceful shutdown and resource cleanup. This prevents resource leaks and allows for responsive user interfaces.

<br />

## 🛡️ Error Handling: A Dual Strategy

Effectively promotes two complementary approaches to error handling. For a comprehensive guide on error handling strategies, see the [Error Handling Guide](docs/error-handling.md).

### 1. Domain Errors: Use `Result<T, E>`

For expected failures that are part of your business logic (e.g., validation errors), use the `Result` type from `neverthrow`. This forces you to handle potential failures at compile time.

```typescript
import { Result, ok, err } from 'neverthrow';

// Note: All context types must include scope: Scope
interface AppContext {
  scope: Scope;
  // ... your other context properties
}

const { defineTask } = createContext<AppContext>({ /* ... */ });

const validateAge = defineTask(async (age: number): Promise<Result<number, ValidationError>> => {
  if (age < 0) return err(new ValidationError('Age cannot be negative'));
  return ok(age);
});

// Force handling at compile time
const workflow = createWorkflow(
  validateAge,
  (result) => result.match({
    ok: (age) => `Valid age: ${age}`,
    err: (error) => `Invalid: ${error.message}`
  })
);
```

### 2. System Panics: Use `withErrorBoundary`

For unexpected failures that represent system-level problems (e.g., network down, database connection lost), use `withErrorBoundary`. This allows you to catch and handle specific error types at runtime.

```typescript
const protectedWorkflow = withErrorBoundary(
  riskyDatabaseOperation,
  createErrorHandler(
    [NetworkError, async (err) => {
      await logToSentry(err);
      return cachedFallbackData;
    }],
    [DatabaseError, async (err) => {
      await notifyOps(err);
      throw new ServiceUnavailableError();
    }]
  )
);
```

This dual approach ensures:
- **Compile-time safety** for predictable errors
- **Runtime resilience** for unexpected failures
- **Clear separation** between business logic and infrastructure concerns

### Traditional `try/catch` & `Promise.catch()` (Seamless Integration)

**Effectively is designed to work beautifully with the error handling mechanisms you already know.** You don't need to abandon `try/catch` or `Promise.catch()`. In fact, they are often the simplest way to handle errors within the logic of a single task or when integrating with third-party libraries.

Since Effectively tasks are fundamentally `async` functions returning Promises, standard JavaScript error handling just works.

```typescript
// import { defineTask, run, createContext, type BaseContext } from '@doeixd/effectively'; // Assuming imports

// const { defineTask: appDefineTask, run: appRun } = createContext<BaseContext>({});

// --- Using try/catch within a Task's logic ---
const taskWithInternalTryCatch = appDefineTask(async (path: string) => {
  let fileContent: string;
  try {
    // Simulate an operation that might throw
    if (path === 'nonexistent.txt') {
      throw new Error(`File not found: ${path}`);
    }
    fileContent = `Content of ${path}`; // Replace with actual fs.readFile
    console.log(`Successfully read ${path}`);
  } catch (error: any) {
    console.error(`[Task Logic] Failed to read file '${path}': ${error.message}`);
    // You can handle it here, re-throw, or return a default/error indicator
    fileContent = `Error reading ${path}: ${error.message}`; // Recover with an error message
    // Or: throw new CustomError("Failed to process file", { cause: error });
  }
  return `Processed: ${fileContent}`;
});

// --- Using .catch() when running a Task or Workflow ---
const potentiallyFailingTask = appDefineTask(async (shouldFail: boolean) => {
  if (shouldFail) {
    throw new Error("Simulated failure in task");
  }
  return "Task succeeded!";
});

// You can use .catch() directly on the Promise returned by run()
 appRun(potentiallyFailingTask, true)
   .then(result => console.log("Run succeeded:", result))
   .catch(error => console.error("Run failed with .catch():", error.message));

// Or within an async function:
async function executeAndHandle() {
  try {
    const result = await appRun(potentiallyFailingTask, false);
    console.log("Traditional try/catch: Task result:", result);

    await appRun(potentiallyFailingTask, true); // This will throw
  } catch (error: any) {
    console.error("Traditional try/catch: Caught error from run():", error.message);
  }
}
executeAndHandle();
```

<br />

## 🚀 Features

### Guaranteed Resource Cleanup

Never leak resources again with the `bracket` pattern, which ensures a `release` function is always called, even if the `use` function throws an error. For detailed resource management patterns, see the [Bracket Resource Management Guide](docs/bracket-resource-management.md).

```typescript
const processFile = withResource({
  acquire: () => openFile('data.csv'),
  use: (file) => parseAndProcess(file),
  release: (file) => file.close() // Always runs!
});
```

### Built-in Resilience Patterns

Add production-grade resilience to any task with simple wrappers.

```typescript
// Automatic retries with exponential backoff
const resilientFetch = withRetry(fetchData, {
  attempts: 3,
  delayMs: 1000,
  backoff: 'exponential'
});

// Timeouts to prevent long-running operations
const quickFetch = withTimeout(fetchData, 5000);

// Circuit breakers to prevent cascading failures
const protectedCall = withCircuitBreaker(externalApi, {
  failureThreshold: 5,
  resetTimeout: 60000
});
```

### Structured Concurrency

Go beyond `Promise.all` with named results, partial failure handling, and efficient data processing. For advanced concurrency patterns and native scheduler integration, see the [Parallel Execution Guide](docs/parallel.md).

```typescript
// Parallel execution with named results
const results = await run(
  createWorkflow(
    fromValue(userData),
    forkJoin({
      profile: fetchProfile,
      orders: fetchOrders,
      preferences: fetchPreferences
    })
  )
);
// results: { profile: Profile, orders: Order[], preferences: Prefs }

// Map-reduce for parallel data processing
const total = await mapReduce(
  orderIds,
  (id) => fetchOrderAmount(id),  // Runs in parallel
  (acc, amount) => acc + amount,  // Sequential reduction
  0
);
```

### Memory-Safe Long-Running Workflows

Effectively prevents memory accumulation in long-running workflows through stateless execution and automatic cleanup.

```typescript
// Process millions of items without memory leaks
const processLargeDataset = mapReduce(
  millionItems,
  processItem,           // Parallel processing
  (acc, result) => acc + result.value,  // Sequential aggregation
  0,
  { concurrency: 10 }    // Bounded concurrency prevents memory spikes
);

// Batch processing with automatic context cleanup
const processBatch = defineTask(async (items: Item[]) => {
  const batchSize = 1000;
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processItems(batch);
    // Each batch's context is cleaned up automatically
  }
});
```

**Key Memory Management Features:**
- **Stateless Execution:** Contexts are created fresh for each workflow and disposed automatically
- **Scope-Based Cleanup:** AbortControllers and event listeners are cleaned up in finally blocks
- **No Accumulation:** Tasks don't retain state between executions, preventing memory leaks
- **Resource Bracketing:** Guaranteed cleanup of connections, files, and other resources

<br />

## 🤔 Comparisons & Where It Fits

Effectively offers a powerful and pragmatic approach to building resilient TypeScript applications. Understanding how it compares to other tools and paradigms can help you decide if it's the right fit for your project. Our core philosophy is to **enhance `async/await` with structured patterns and opt-in algebraic effects**, rather than requiring a full paradigm shift.

For a deeper dive into the motivations, see [Why Effectively?](docs/why-effectively.md).

### 1. Plain `async/await` & Native Promises

**Use When:**
*   You're writing simple scripts with minimal asynchronous logic.
*   Dependency management is straightforward (e.g., direct imports, few shared services).
*   Error handling, retries, and resource management are trivial or not critical.
*   You're building a very small library where zero external dependencies are paramount.

**How Effectively Differs:**
Plain `async/await` is the foundation. Effectively builds upon it by providing:
*   **Structured Dependency Injection:** The `Context` system eliminates prop-drilling and global singletons.
*   **Composable Units:** `Task` and `Workflow` primitives make complex async flows manageable.
*   **Built-in Resilience:** `withRetry`, `withTimeout`, `withCircuitBreaker` add production-readiness easily.
*   **Guaranteed Resource Cleanup:** The `bracket` pattern prevents leaks.
*   **Standardized Error Handling:** A clear strategy for domain vs. system errors.
*   **Opt-in Algebraic Effects:** For abstracting side effects when needed, without forcing it everywhere.

Effectively aims to be the natural next step when your `async/await` code starts to become complex and brittle.

### 2. Full Functional Effect Systems (e.g., Effect-TS, fp-ts)

These libraries provide powerful, all-encompassing ecosystems for purely functional programming, often with their own runtimes (like fibers) and a deep emphasis on type-driven development and total effect tracking.

**Use When:**
*   Your team is fully committed to and proficient in pure functional programming.
*   You require the advanced capabilities of a fiber-based runtime (e.g., fine-grained concurrency control, true delimited continuations).
*   You want compile-time guarantees for *all* side effects, enforced by the type system across the entire application.
*   Learning a new, comprehensive programming model is acceptable for the benefits gained.

**How Effectively Differs:**
*   **Lower Learning Curve:** Builds directly on `async/await` and familiar TypeScript patterns. The algebraic effects system in Effectively is opt-in and designed to be more approachable.
*   **Seamless Integration:** Works effortlessly with existing Promise-based libraries and codebases. No need to wrap everything in a special `Effect` type.
*   **Pragmatism over Purity:** While encouraging good patterns, Effectively doesn't enforce strict purity for all operations. Its effects system is a tool for better testability and abstraction where it provides the most value.
*   **Familiar Debugging:** Stack traces and debugging feel closer to standard TypeScript `async/await`.

Effectively offers many benefits of structured programming and effect management without the steep learning curve or the "all-or-nothing" commitment of full FP effect systems.

### 3. Generator-Based Algebraic Effect Libraries (e.g., Tinyeffect)

Libraries like Tinyeffect use generator functions (`function*`) and `yield*` as the primary mechanism to define and handle all side effects (DI, errors, async operations) in a unified, type-safe manner.

**Use When:**
*   You want a **singular, unified model** for all side effects, where everything is an explicitly declared and handled effect.
*   Your team is comfortable with generator-based control flow as the dominant pattern.
*   The strong compile-time guarantee that *all* declared effects are handled before runtime is paramount.
*   The "purity" of knowing exactly what effects a piece of code can perform (from its type signature) is a primary design goal.

**How Effectively Differs:**
*   **`async/await` as the Core:** Effectively's `Tasks` are standard `async` functions. This provides a more conventional programming model for many developers and easier integration with the broader JavaScript/TypeScript ecosystem. Generators are opt-in for `doTask` notation.
*   **Separate Concerns, Synergistic Solutions:**
    *   **Dependency Injection:** Effectively has a robust, dedicated `Context` system that is intuitive and powerful on its own, independent of the effects system.
    *   **Error Handling:** Provides a pragmatic dual strategy (`Result` for domain errors, `withErrorBoundary` for panics) that works well with standard `async/await` throwing behavior.
    *   **Algebraic Effects:** Effectively's `defineEffect` and `withHandlers` system allows abstracting specific side effects where beneficial (e.g., for testability or swappable implementations), but doesn't *require* DI or basic async operations to be effects.
*   **Progressive Enhancement:** You can use Effectively's `Context`, `Workflows`, and resilience patterns without immediately diving into its algebraic effects system. Adopt features as your application's complexity grows.
*   **Built-in Utilities Beyond Effects:** Patterns like `bracket`, `withRetry`, and `forkJoin` are first-class utilities, not just patterns to be implemented via custom effect handlers.

The table below summarizes key differences with more direct competitors in the "effects" space:

| Aspect                     | **Effectively**                                                                 | **Effect-TS**                                  | **Tinyeffect**                                         |
| :------------------------- | :------------------------------------------------------------------------------ | :--------------------------------------------- | :----------------------------------------------------- |
| **Primary Paradigm**       | Enhances `async/await` with patterns & opt-in algebraic effects via `Context`   | Pure Functional Programming, Fiber-based runtime | Algebraic effects via Generators                       |
| **Core Abstraction**       | `Task` (async function), `Context`, `Workflow`                                  | `Effect` data type                               | `Effected` program (generator)                       |
| **Learning Curve**         | Low to Medium (builds on existing knowledge, effects are opt-in)              | High (new programming model & ecosystem)       | Medium (generator syntax, effect handling model)       |
| **Integration**            | Seamless with existing Promise-based code                                       | Requires wrapping code in `Effect` runtime       | Requires generator functions & `yield*`; `effectify` for Promises |
| **DI Approach**            | Explicit `Context` system, `getContext()`, overrides                          | Typically via `Context` or `Layer` (Effect's DI) | `dependency` effect, handled by `provide`              |
| **Error Handling**         | `Result<T,E>` for domain, `withErrorBoundary` for panics; Tasks can throw      | All errors are values within `Effect` type     | Errors are `error` effects, handled by `catch`         |
| **Effect System Scope**    | Opt-in for specific side effects (e.g., I/O, external services)                 | All side effects are managed by `Effect`       | All side effects are managed by `effected` programs    |
| **Best For**               | Teams wanting structured `async/await`, pragmatic DI, resilience, and testable side effects with a gradual learning curve. | Teams committed to pure FP, seeking maximum purity, type safety, and powerful concurrency abstractions. | Teams wanting a unified, type-safe model for *all* side effects using generators. |

### 4. Reactive Programming (e.g., RxJS)

**Use When:**
*   Your application is primarily event-driven and involves managing complex streams of asynchronous events over time (e.g., UI interactions, WebSockets, real-time data feeds).
*   You need powerful stream manipulation operators like `debounce`, `throttle`, `buffer`, `mergeMap`, etc.

**How Effectively Differs:**
Effectively is designed for managing **workflows** – sequences of operations that typically have a defined start and end, often involving fetching data, processing it, and producing a result or side effect. RxJS excels at managing ongoing **streams** of events. While there can be overlap, their primary use cases are distinct. You might even use both in a larger application (e.g., RxJS for UI events, triggering an Effectively workflow).

### 5. Synchronous Code

**Use When:**
*   Your code doesn't involve I/O, timers, or other asynchronous operations.
*   You are performing pure computations on in-memory data.

**How Effectively Differs:**
Effectively is specifically for asynchronous code. Introducing its patterns for purely synchronous logic would be unnecessary overhead.

<br />

## 🧠 Advanced Concepts

### Non-Linear Control Flow: Backtracking and Effects

Effectively provides powerful non-linear control flow through **backtracking**. Throwing a `BacktrackSignal` allows a workflow to jump back to a previously executed task. This is ideal for retries, polling, and state machines.

```typescript
const retryableTask = defineTask(async (attempt: number) => {
  const result = await riskyOperation();

  if (result.needsRetry && attempt < 3) {
    // Jump back to this same task with an incremented attempt number
    throw new BacktrackSignal(retryableTask, attempt + 1);
  }

  return result;
});
```

**Important:** Tasks must be created with `defineTask` to enable backtracking, as this assigns a unique ID used by the runtime.

#### No Trampolining, No Rollback

Unlike some effect systems, Effectively **does not use trampolining** and **does not provide automatic rollback** of side effects. This design choice has important implications:

- **Performance**: Direct function calls without trampolines mean better performance and stack traces
- **Side Effects**: When backtracking occurs, any side effects that have already happened remain in place
- **Responsibility**: You are responsible for designing idempotent operations or manually cleaning up state when retrying

```typescript
const taskWithSideEffects = defineTask(async (attempt: number) => {
  // This side effect will happen every time we backtrack
  await logAttempt(attempt);
  await incrementCounter(); // This won't be rolled back!

  const result = await riskyOperation();
  if (result.needsRetry && attempt < 3) {
    // The log and counter increment above have already happened
    // and won't be undone when we backtrack
    throw new BacktrackSignal(taskWithSideEffects, attempt + 1);
  }

  return result;
});
```

This makes the control flow easy to reason about - effects happen when they execute, period. For operations that need atomicity, use patterns like the bracket pattern or explicit transaction management.

### Concurrency: Leveraging the Platform

Effectively embraces the browser and Node.js's native concurrency primitives rather than reimplementing them. This means it uses `scheduler.postTask` when available for cooperative multitasking, and you can leverage `SharedArrayBuffer` and `Atomics` when using the Web Worker integration for true parallelism.

### Do-Notation for Monadic Composition

Effectively supports Haskell-style do-notation using generator functions for elegant monadic composition. The `doTask` function allows you to chain operations using `yield` syntax:

```typescript
const userWorkflow = doTask(function* (userId: string) {
  const user = yield fetchUser(userId);
  const profile = yield fetchProfile(user.id);
  const permissions = yield fetchPermissions(user.role);

  // Use pure() to lift plain values into the monadic context
  return yield pure({
    user,
    profile,
    permissions
  });
});
```

#### Generator Composition with `yield*`

You can compose and reuse generator functions using `yield*` for powerful modular patterns:

```typescript
// Reusable sub-generators
function* fetchUserCore(userId: string) {
  const user = yield getUser(userId);
  const profile = yield getProfile(user.id);
  return { user, profile };
}

// Compose them into larger workflows
const completeUserData = doTask(function* (userId: string) {
  const coreData = yield* fetchUserCore(userId);  // Delegate to sub-generator
  const settings = yield getSettings(userId);     // Direct yield
  return { ...coreData, settings };
});
```

This provides a clean alternative to deeply nested `.then()` chains or complex workflow compositions, with support for both direct value unwrapping (`yield`) and generator composition (`yield*`).

<br />

## 📚 Guides & Deeper Dives

### Our Philosophy & FAQ 

Curious about the "why" behind our design decisions? We've written a detailed article explaining our core philosophy of pragmatism, why we choose to enhance `async/await` rather than replace it, and how `Effectively` compares to powerful functional ecosystems like Effect-TS. If you've ever wondered about our take on runtimes, fibers, and typed errors, this is the definitive guide.
[Why Effectively](docs/why-effectively.md) &nbsp;•&nbsp; [Philosophy & FAQ](docs/faq-our-philosophy.md) &nbsp;•&nbsp;  [Effectively vs Effect.ts](docs/effect-ts-vs-effectively.md)


### Smart Context System

For a comprehensive guide to the smart context system with smart, local-only, and global-only functions, see the [Context System Guide](docs/context-system.md). This covers when to use each variant, migration strategies, and best practices for different use cases.

### Effect Handlers

For detailed information on building testable, modular code with algebraic effect handlers, see the [Effect Handlers Guide](docs/effect-handlers.md). This covers effect definition, handler creation, testing patterns, and advanced composition techniques.

### Do Notation with Generator Syntax

For more detailed information on monadic composition using generators, see the [Do Notation Guide](docs/do-notation.md). This covers advanced patterns, error handling within do blocks, and performance considerations.

### Performance & Debugging

Pass a logger to the `run` function to get detailed insight into your workflow's execution, including task timing and success/failure states. For large datasets, use `stream()` or `mapReduce()` with a `concurrency` limit to process data efficiently without overwhelming the system. For advanced concurrency control and native scheduler integration, see the [Parallel Execution Guide](docs/parallel.md).

### Setting Up Web Workers

Offload CPU-intensive work to a separate thread without the usual boilerplate.

**1. Worker File (`worker.ts`)**
```typescript
import { createWorkerHandler, defineTask } from '@doeixd/effectively/worker';

const heavyCalculation = defineTask(async (data: number[]) => {
  // ... intensive processing
  return processedData;
});

createWorkerHandler({ heavyCalculation });
```

**2. Main Thread (`main.ts`)**
```typescript
import { runOnWorker } from '@doeixd/effectively';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const calculateOnWorker = runOnWorker(worker, 'heavyCalculation');
const result = await run(calculateOnWorker, myDataArray);
```

### Creating Custom Enhancers

An enhancer is a function that takes a Task and returns a new Task with added behavior. This is a powerful way to create reusable patterns.

```typescript
// An enhancer that adds caching to any task
const withCache = <C extends { cache: Cache }, V, R>(
  task: Task<C, V, R>,
  options: { ttl: number }
): Task<C, V, R> => {
  return defineTask(async (value: V) => {
    const { cache } = getContext<C>();
    const key = JSON.stringify(value);

    const cached = await cache.get(key);
    if (cached) return cached as R;

    const result = await task(getContext(), value);
    await cache.set(key, result, options.ttl);
    return result;
  });
};
```

<br />

## 📋 Best Practices

- **Keep Tasks Focused:** Each task should have a single responsibility. Compose them in workflows rather than creating monolithic tasks.
- **Use `Result` for Domain Errors:** Use `neverthrow`'s `Result` type for predictable errors (e.g., validation), forcing compile-time checks.
- **Use `withErrorBoundary` for System Errors:** Reserve throwing and error boundaries for unexpected system failures (e.g., network loss).
- **Define Clear Context Interfaces:** Keep your `AppContext` clean and well-defined. Pass request-specific data through the workflow, not in the context.
- **Always Use `bracket` for Resources:** Guarantee cleanup for files, database connections, or other resources that need explicit closing.

<br />

## ⚠️ Common Pitfalls & Solutions

### Context-Related Issues

- **`ContextNotFoundError` with smart functions:** You called `getContext()` outside of any execution context and there's no global default. The smart functions will automatically use global context as fallback, but if you're using `getContextLocal()`, it requires an active context.
- **Unexpected context behavior:** If you're getting a different context than expected, check which function variant you're using:
  - `getContext()` (smart) - uses current context or global fallback
  - `getContextLocal()` - requires current context, throws if none
  - `getContextGlobal()` - always uses global, ignores current context
- **Type safety issues:** Use generic versions for type safety: `getContext<MyContext>()` instead of `getContext()` when you know the context type.
- **Context not inheriting properties:** Remember that `defineTask()` is smart and will inherit the context it's defined in. Use `defineTaskGlobal()` if you need consistent global context behavior.

### General Issues

- **Enhancer Not Working:** Enhancers (`withRetry`, `withTimeout`, etc.) return a *new* task. You must use the returned value. `const retried = withRetry(myTask);` not `withRetry(myTask);`.
- **Backtracking Not Working:** The target task was not created with `defineTask`. The runtime needs the `__task_id` assigned by `defineTask` to find it.
- **Workflow Stops Midway:** An unhandled error was likely thrown. Debug by running with `{ throw: false }` to inspect the returned `Result` object: `const result = await run(workflow, input, { throw: false });`.

### Choosing the Right Context Function

Use this guide to choose the appropriate context function:

| Use Case | Function | Reason |
|----------|----------|---------|
| General usage, want convenience | `getContext()` | Smart fallback behavior |
| Want type safety | `getContext<MyContext>()` | Explicit typing |
| Must ensure you're in a specific context | `getContextLocal<MyContext>()` | Throws if wrong context |
| Always want global context | `getContextGlobal()` | Predictable behavior |
| Building a library | `getContextLocal()` or `getContext<C>()` | Explicit context requirements |

### Async Context & Environment Issues

Effectively uses [unctx](https://github.com/unjs/unctx) under the hood for context management, which can present challenges in certain environments:

#### **"Context is not available" Errors**

**Problem:** Tasks throw "Context is not available" when run in certain environments (tests, browsers, edge functions).

**Causes & Solutions:**

1. **AsyncLocalStorage Unavailable:**
   - **Browser environments:** `AsyncLocalStorage` is Node.js-specific and not available in browsers
   - **Edge environments:** Some edge runtimes don't support `node:async_hooks`
   - **Solution:** Effectively automatically falls back to sync context when `AsyncLocalStorage` fails, but you may need to wrap async functions

2. **Context Lost After Await:**
   ```typescript
   // ❌ This will lose context after the await
   const task = defineTask(async (input) => {
     const context = getContext(); // Works
     await someAsyncOperation();
     const context2 = getContext(); // ❌ May throw "Context is not available"
   });
   ```

   **Solutions:**
   - **Cache context early:** Store context in a variable before async operations
   ```typescript
   const task = defineTask(async (input) => {
     const context = getContext(); // Cache it
     await someAsyncOperation();
     // Use cached context instead of calling getContext() again
   });
   ```
   - **Use unctx transform (advanced):** Install the unctx Vite/Webpack plugin to automatically preserve context

#### **Build Tool Integration (Advanced)**

For applications that heavily use async operations and need context preserved across await boundaries, consider using the unctx transform:

**Vite Integration:**
```typescript
// vite.config.ts
import { unctxPlugin } from 'unctx/plugin';

export default {
  plugins: [
    unctxPlugin.vite({
      // Transform these functions to preserve context
      asyncFunctions: ['callAsync', 'provide']
    })
  ]
};
```

**Usage with Transform:**
```typescript
import { withAsyncContext } from 'unctx';

// Wrap async functions that need context preservation
const myAsyncTask = withAsyncContext(async () => {
  const context = getContext(); // Works
  await someAsyncOperation();
  const context2 = getContext(); // ✅ Still works with transform
});
```

#### **Testing Environment Issues**

**Vitest/Jest Browser Mode:**
```typescript
// If running tests in browser mode, you may need to mock AsyncLocalStorage
// vitest.config.ts
export default {
  test: {
    environment: 'jsdom', // or 'happy-dom'
    // Mock node modules in browser environment
    server: {
      deps: {
        external: ['node:async_hooks']
      }
    }
  }
};
```

#### **Best Practices for Async Context**

1. **Cache Context Early:** Always get context at the start of tasks, before any async operations
2. **Use Smart Functions:** Prefer `getContext()` over `getContextLocal()` for better fallback behavior
3. **Avoid Deep Async Chains:** Keep async operations within task boundaries rather than spreading across multiple function calls
4. **Test in Target Environment:** Context behavior can differ between Node.js, browsers, and edge environments

<br />


## 🔧 Common Patterns

Here are practical examples of common patterns you'll use in production:

### Authentication Flow with Token Refresh

```typescript
const checkTokenExpiry = defineTask(async (token: AuthToken) => {
  return { token, isExpired: new Date() >= new Date(token.expiresAt) };
});

const refreshToken = defineTask(async ({ token }: { token: AuthToken }) => {
  const { authApi } = getContext();
  return authApi.refresh(token.refreshToken);
});

const authenticatedRequest = createWorkflow(
  checkTokenExpiry,
  ift(
    (result) => result.isExpired,
    refreshToken,
    (result) => result.token
  ),
  makeApiRequest
);
```

### Polling with Exponential Backoff

```typescript
const pollJobStatus = defineTask(async (params: { jobId: string; attempt: number }) => {
  const { api } = getContext();
  const result = await api.checkJobStatus(params.jobId);

  if (!result.isComplete) {
    const backoffMs = Math.min(1000 * Math.pow(2, params.attempt), 30000);
    await new Promise(res => setTimeout(res, backoffMs)); // sleep

    // Jump back to the start of this same task
    throw new BacktrackSignal(pollJobStatus, {
      jobId: params.jobId,
      attempt: params.attempt + 1
    });
  }

  return result.data;
});
```

### Batch Processing with Progress

```typescript
const processBatch = defineTask(async (items: Item[]) => {
  const { logger } = getContext();
  const batchSize = 10;
  let results: ProcessedItem[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);

    const batchResults = await mapReduce(
      batch,
      processItem,
      (acc, item) => [...acc, item],
      [] as ProcessedItem[]
    );

    results = [...results, ...batchResults];
    logger.info(`Processed ${results.length}/${items.length} items`);
  }

  return results;
});
```

<br />

## 🧪 Testing Your Workflows

Effectively makes testing a breeze by allowing you to inject mock dependencies at runtime.

```typescript
import { describe, it, expect, jest } from '@jest/globals';

describe('Payment Workflow', () => {
  it('should process payment successfully', async () => {
    // Mock your dependencies
    const mockStripeApi = {
      chargeCard: jest.fn().mockResolvedValue({ success: true, chargeId: 'ch_123' })
    };

    // Run the workflow with mocks
    const result = await run(paymentWorkflow, { amount: 100, cardToken: 'tok_visa' }, {
      overrides: { stripeApi: mockStripeApi }
    });

    // Assert on the result and mock calls
    expect(result.chargeId).toBe('ch_123');
    expect(mockStripeApi.chargeCard).toHaveBeenCalledWith({ amount: 100, cardToken: 'tok_visa' });
  });

  it('should handle payment failures gracefully', async () => {
    const mockStripeApi = {
      chargeCard: jest.fn().mockRejectedValue(new Error('Card declined'))
    };

    // Use { throw: false } to get a Result instead of throwing
    const result = await run(paymentWorkflow, invalidCard, {
      throw: false,
      overrides: { stripeApi: mockStripeApi }
    });

    expect(result.isErr()).toBe(true);
    expect(result.error).toBeInstanceOf(PaymentError);
    expect(result.error.message).toContain('Card declined');
  });
});
```

<br />

## 🧰 API Reference

### Core Engine

#### Context Creation
| Function | Description |
|----------|-------------|
| `createContext<C>(defaults)` | Creates a new, isolated system with its own `run`, `getContext`, `provide`, etc., all strongly typed to the context `C`. |

#### Smart Context Functions (recommended)
| Function | Description |
|----------|-------------|
| `defineTask<C, V, R>(fn, options?)` | **Smart**: Defines a portable `Task`. `C` is a type hint for `getContext<C>()` calls inside `fn`. Returns `Task<any, V, R>`. |
| `getContext<C>()` | **Smart**: Gets the current context if active, otherwise falls back to the global default. Never throws. |
| `getContextSafe<C>()` | **Smart**: Returns `Result<C, ContextNotFoundError>`. Designed to always return `Ok(context)`. |
| `getContextOrUndefined<C>()` | **Smart**: Returns the current or global default context. Designed to never return `undefined`. |
| `run<V, R>(task, value, options?)` | **Smart**: Executes a task. Inherits from the current context if active, otherwise uses the global default. `options` can include `{ throw: false }`, `overrides`, and `parentSignal`. |
| `provide(overrides, fn, options?)` | **Smart**: Temporarily modifies the current or global context for the execution of `fn`. |
| `provideWithProxy(overrides, fn)` | **Smart**: A high-performance version of `provide` that uses a `Proxy` to avoid cloning the context object. |

#### Local-Only Context Functions (current context required)
| Function | Description |
|----------|-------------|
| `defineTaskLocal<C, V, R>(fn, options?)` | **Local**: Defines a `Task<C,V,R>` that is strictly bound to the currently active context `C`. Throws if no context is active. |
| `getContextLocal<C>()` | **Local**: Gets the current specific context. Throws `ContextNotFoundError` if none exists. |
| `getContextSafeLocal<C>()` | **Local**: Returns `Ok(context)` if a specific context is active, otherwise `Err(ContextNotFoundError)`. |
| `getContextOrUndefinedLocal<C>()` | **Local**: Returns the current specific context or `undefined`. Never uses the global fallback. |
| `runLocal<C, V, R>(task, value, options?)` | **Local**: Executes a workflow in the current specific context only. Throws if no context is active. |
| `provideLocal<C, R>(overrides, fn, options?)` | **Local**: Modifies the current specific context only. Throws if no context is active. |

#### Global-Only Context Functions (explicit global usage)
| Function | Description |
|----------|-------------|
| `defineTaskGlobal<V, R>(fn, options?)` | **Global**: Defines a `Task<DefaultGlobalContext, V, R>` that is always bound to the global context. |
| `getContextGlobal()` | **Global**: Always gets the global default context. |
| `runGlobal<V, R>(task, value, options?)` | **Global**: Always executes a task in the global default context. |
| `provideGlobal<R>(overrides, fn, options?)` | **Global**: Always modifies the global default context. |

### Composition & Utilities
| Function | Pattern | Description |
|----------|---------|-------------|
| `createWorkflow(...tasks)` | Standalone | Chains tasks and functions into a sequential workflow. Automatically "lifts" plain functions into Tasks. |
| `chain(...tasks)` | Standalone | An alias for `createWorkflow`. |
| `fromValue(value)` | Standalone | Starts a workflow with a static, known value. |
| `fromPromise(promise)` | Standalone | Starts a workflow by awaiting a `Promise`. |
| `fromPromiseFn(fn)` | Standalone | Starts a workflow by executing a context-aware async function. |
| `map(fn)` | Pipeable | Transforms the value in a workflow using a `(value, context) => result` function. |
| `flatMap(fn)` | Pipeable | Transforms the value into a new `Task` and executes it. `(value, context) => Task`. |
| `tap(fn)` | Pipeable | Performs a side effect `(value, context) => void` without changing the workflow's value. |
| `pick(...keys)` | Pipeable | Creates a new object from the input object, containing only the specified keys. |
| `mapTask(task, fn)` | Standalone | Composes a task with a function that maps its result. `task -> (result -> newResult)`. |
| `andThenTask(task, fn)` | Standalone | Composes a task with a function that uses its result to create the next task. `task -> (result -> nextTask)`. |
| `sleep(ms)` | Standalone | A `Task` that pauses the workflow for a specified duration in milliseconds. |
| `flow(...fns)` | Standalone | Composes a sequence of functions into a single new function. |
| `pipe(value, ...fns)` | Standalone | Passes a value through a sequence of functions. |

### Do-Notation & Monadic Composition
| Function | Description |
|----------|-------------|
| `doTask(generatorFn)` | Enables Haskell-style do-notation using generator functions for monadic composition. |
| `createDoNotation<C>()` | Creates context-specific do-notation functions (`doTask`, `doBlock`) with better type inference. |
| `pure(value)` | Lifts a plain value into the monadic context. Useful for returning values inside a do-block. `return yield pure(value);` |
| `call(task, input)` | Helper to call a task with specific input parameters inside a do-block. |
| `doWhen(condition, onTrue, onFalse)` | Conditional monadic execution. Executes one of two monadic values based on a boolean. |
| `doUnless(condition, action)` | Executes a monadic action only if the condition is `false`. |
| `sequence(monadicValues[])` | Executes an array of monadic values in sequence and collects their results into an array. |
| `forEach(items, action)` | Loops over an array, executing a monadic generator function for each item. |

### Error Handling
| Function | Description |
|----------|-------------|
| `withErrorBoundary(task, handlers)` | A "try/catch" for tasks. Catches specified thrown errors and delegates to type-safe handlers. |
| `createErrorHandler(ErrorClass, handlerFn)` | Creates a type-safe handler tuple `[ErrorClass, handlerFn]` for use with `withErrorBoundary`. |
| `createErrorType(options)` | Factory for creating custom, hierarchical error classes that work correctly with `instanceof`. |
| `attempt(task, mapErrorToE?)` | Wraps a task to always return a `Result` (`Ok` or `Err`) instead of throwing (except for `BacktrackSignal`). |
| `tryCatch(fn, mapErrorToE?)` | Converts a regular function that might throw into a function that returns `Promise<Result>`. |
| `tapError(task, onErrorFn, errorConstructor?)`| Performs a side effect on a specific error type without catching it. The error is always re-thrown. |
| `WorkflowError` | Class. The structured error type thrown by `run` on unhandled failures, containing task context. |
| `ContextNotFoundError` | Class. Error thrown when a context is required but not found. |
| `EffectHandlerNotFoundError` | Class. Error thrown when an effect is called but no handler is provided. |

### Resource Management
| Function | Description |
|----------|-------------|
| `withResource({ acquire, use, release, merge })` | Guarantees resource cleanup with an acquire-use-release pattern. Alias for `bracket`. |
| `withDisposableResource({ acquire, use, merge })`| A `withResource` variant for objects with `[Symbol.dispose]` or `[Symbol.asyncDispose]`. |
| `withResources(configs, use)` | Manages multiple resources for a single `use` task, releasing them in reverse order of acquisition. |
| `createResource(key, acquire, release)`| A helper to create a reusable `ResourceDefinition` for use with `withResources`. |
| `asAsyncDisposable(resource, cleanupMethodName)` | A helper to adapt an object with a cleanup method to the `AsyncDisposable` interface. |
| `bracket(...)` | An alias for `withResource`. |
| `bracketDisposable(...)` | An alias for `withDisposableResource`. |
| `bracketMany(...)` | An alias for `withResources`. |

### Resilience Patterns
| Function | Description |
|----------|-------------|
| `withRetry(task, options)` | Automatic retries with configurable `attempts`, `delayMs`, `backoff`, `jitter`, and `shouldRetry`. |
| `withTimeout(task, ms)` | Enforces a time limit for a task's execution, throwing a `TimeoutError` if exceeded. |
| `withCircuitBreaker(task, options)` | Prevents cascading failures. `options` include `id`, `failureThreshold`, and `openStateTimeoutMs`. |
| `withDebounce(task, ms, options?)` | Ensures a task only runs after a period of inactivity. `options` can include `linkToLatestSignal`. |
| `withThrottle(task, options)` | Rate-limits task execution based on a `limit` per `intervalMs`. |
| `withName(task, name)` | Adds a descriptive name to a task for better debugging and observability. |
| `memoize(task, options?)` | Caches task results based on input. `options` can include a `cacheKeyFn`. |
| `once(task)` | Creates a task that is guaranteed to execute only once, returning the cached result on subsequent calls. |

### Concurrency & Parallelism
| Function | Pattern | Description |
|----------|---------|-------------|
| `forkJoin({ a, b })` | Pipeable | Executes a keyed object of tasks in parallel. Fail-fast. |
| `forkJoinSettled({ a, b })` | Pipeable | Executes a keyed object of tasks in parallel, returning a `Result` for each. Never fails. |
| `allTuple([a, b])` | Standalone | Executes an array/tuple of tasks in parallel, returning a typed tuple of results. Fail-fast. |
| `allTupleSettled([a, b])`| Standalone | Executes a tuple of tasks, returning a typed tuple of `Result` for each. |
| `mapReduce(items, options)`| Standalone | Performs a parallel map over an array of items, then a sequential reduce. |
| `filter(predicate, options?)`| Pipeable | Filters an array in parallel using an async predicate task. |
| `groupBy(keyingFn, options?)` | Pipeable | Groups an array in parallel using an async keying task. |
| `stream(tasks, value, options?)` | Standalone | Memory-efficient parallel execution for large or dynamic sets of tasks. Returns an `AsyncIterable`. |

### Control Flow
| Class/Function | Description |
|----------------|-------------|
| `BacktrackSignal(target, value)` | Class. Thrown to jump back to a previous task in a workflow. |
| `isBacktrackSignal(error)` | Type guard for `BacktrackSignal`. |
| `ift(predicate, onTrue, onFalse)` | Pipeable. Conditional branching (if-then-else) for workflows. |
| `when(predicate, task)` | Pipeable. Conditionally executes a task if the predicate is `true`. |
| `unless(predicate, task)`| Pipeable. Conditionally executes a task if the predicate is `false`. |
| `doWhile(task, predicate)`| Standalone. Repeatedly executes a task while the predicate is `true`. |

### Multi-Threading (Web Workers)
| Function | Side | Description |
|----------|------|-------------|
| `createWorkerHandler(tasks, options?)` | Worker | Sets up the worker script to listen for and execute tasks. It automatically sends task metadata to the main thread on startup. |
| `runOnWorker(worker, taskId, options?)` | Main | Creates a `Task` that executes a specific task on the worker (request-response). Best for manual or dynamic task calls. |
| `runStreamOnWorker(worker, taskId, options?)` | Main | Creates a `Task` that returns an `AsyncIterable` for streaming results from a worker. Best for manual or dynamic stream calls. |
| `createWorkerProxy<T>(worker, options?)` | Main | **(Not Recommended)** Returns a `Promise` that resolves to a type-safe proxy for all worker tasks. It's the most ergonomic way to call remote tasks, as it automatically handles whether a task is a stream or a single response. |


### Context & Dependency Injection
| Function | Description |
|----------|-------------|
| `mergeContexts(contextA, contextB)` | Type-safely merges two contexts, with `B`'s properties taking precedence. |
| `validateContext(schema, context)` | Performs runtime validation of a context object against a provided Zod-like schema. |
| `requireContextProperties(...keys)` | A `Task` enhancer that throws if required context properties are missing. |
| `createInjectionToken<T>(description)` | Creates a unique, type-safe token for dependency injection. |
| `inject(token)` | Injects a dependency by its token from the current context. Throws if not found. |
| `injectOptional(token)` | Safely injects a dependency by its token, returning `undefined` if not found. |
| `withContextEnhancement(enhancement, task)`| A `Task` enhancer that provides additional context properties to a child task. |

### Advanced Context Tools
| Function | Description |
|----------|-------------|
| `createContextTransformer(transformer)` | Creates a reusable function for transforming a context object. |
| `useContextProperty(key)` | A hook-like accessor for retrieving a specific property from the current context. |
| `withScope(providers, task)` | Temporarily provides additional services in a `Task`'s scope (primarily for DI tokens). |
| `createLazyDependency(factory)` | Creates dependencies that are only instantiated when first accessed. |

### Advanced Utilities
| Function | Description |
|----------|-------------|
| `withState(initialState, task)` | A `Task` enhancer providing stateful operations. Access state via the `useState()` hook. |
| `withPoll(task, options)` | A `Task` enhancer that polls another task until a condition is met or a timeout occurs. |
| `createBatchingTask(batchFn, options)`| Creates a task that automatically batches multiple calls into a single operation (like DataLoader). |
| `PollTimeoutError` | Class. The error thrown when a `withPoll` operation exceeds its timeout. |
| `TimeoutError` | Class. The error thrown when a `withTimeout` operation exceeds its duration. |

### Effect Handlers

| Function / Property                      | Description                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`createEffectSuite<T>()`**             | **(Recommended for Multiple Effects)** The primary entry point for managing a full domain of effects. Creates a complete, type-safe suite of tools (`effects`, `createHandlers`, `withHandlers`) that are all bound to a single effects contract `T` for end-to-end type safety. |
| `.effects`                               | (Returned by `createEffectSuite`) The proxy object used to declare multiple effects in your tasks.                                                                                                                                                                                                                               |
| `.createHandlers(handlers)`              | (Returned by `createEffectSuite`) A type-safe factory for creating handler implementations that are guaranteed to match the suite's contract.                                                                                                                                                                                    |
| `.withHandlers(handlers)`                | (Returned by `createEffectSuite`) A type-safe wrapper to provide a full set of handlers to a `run` call, ensuring they match the suite's contract.                                                                                                                                                                                 |
| **`defineEffect<T>(effectName)`**        | **(Recommended for Single Effects)** Defines a typed placeholder for a single effect. Returns a callable function with helper methods attached for easily and safely providing implementations.                                                                                                                                      |
| `.withHandler(implementation)`           | (Attached to `defineEffect`'s return) **The simplest and safest way** to provide a one-off implementation for a single effect, especially for overrides in tests.                                                                                                                                                                    |
| `.createHandler(implementation)`         | (Attached to `defineEffect`'s return) Creates a single-entry `Handlers` object from an implementation, which is useful for manual composition.                                                                                                                                                                                      |
| `withHandler(...)`                       | An **advanced standalone function** with multiple overloads for providing a single handler. It can be used with an effect object (`withHandler(effect, impl)`), an effect name and type (`withHandler<T>('name', impl)`), or an effects suite (`withHandler(suite, 'name', impl)`). |
| `defineEffects<T>()`                     | A helper to define multiple effects at once. For new projects, `createEffectSuite` is the recommended alternative.                                                                                                                                                                                                        |
| `createHandlers<T>(handlers)`            | A standalone factory for creating a `Handlers` object. Can be made safer by using an explicit generic (`<T>`).                                                                                                                                                                                                               |
| `withHandlers<T>(handlers)`              | A standalone helper to provide multiple handlers to `run`. Can be made safer by using an explicit generic (`<T>`).                                                                                                                                                                                                           |
| `HANDLERS_KEY`                           | The internal `Symbol` used as the key for storing effect handlers in the context. This is typically abstracted away by helpers and is only needed for advanced, manual context manipulation.                                                                                                                                       |

### Task Enhancers
| Function | Description |
|----------|-------------|
| `composeEnhancers(...enhancers)` | Composes multiple `TaskEnhancer` functions into a single enhancer. Applied right-to-left. |
| `createTaskEnhancer(factory, options?)`| A factory to simplify creating new `TaskEnhancer`s, handling metadata consistently. |
| `finalizeEnhancedTask(original, enhanced, meta?)` | A low-level helper for enhancer authors to apply metadata (`name`, `__task_id`) to an enhanced task. |

### OpenTelemetry Integration
| Function | Description |
|----------|-------------|
| `withSpan(task, options?)` | Wraps a task execution in an OpenTelemetry span, with fallback to logging. |
| `recordMetric(context, type, options, value?)` | Records a `counter`, `histogram`, or `gauge` metric, with fallback to logging. |
| `withObservability(task, options?)` | A comprehensive enhancer combining tracing, timing, and counting metrics. |
| `withTiming(task, metricName)` | A focused enhancer that measures and records a task's execution time as a histogram. |
| `withCounter(task, counterName)`| A focused enhancer that counts successful and failed task executions. |
| `addSpanAttributes(context, attributes)`| Adds structured data (attributes) to the current active span. |
| `recordSpanException(context, error)`| Records an exception within the current active span. |
| `createTelemetryContext(providers)`| A helper to create a context object containing OpenTelemetry `tracer` and `meter` providers. |
| `@traced(spanName?)` | A method decorator for automatically tracing class method executions. |


<br />

## 🤝 Contributing

We welcome contributions! Check our [Contributing Guide](CONTRIBUTING.md) for details.

<br />

## 📄 License

MIT - Use freely in your projects.
