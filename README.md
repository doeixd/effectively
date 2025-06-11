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

**The Solution:** Effectively provides battle-tested patterns for these problems without forcing you to learn a new programming paradigm. If you can write `async/await`, you can use Effectively. [See more](docs/why-effectively.md)

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

In Effectively, everything starts with a simple idea: a **Task** is just an async function that takes two parameters: a `context` and a `value`.

```typescript
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
  scope: Scope;
  greeting: string;
}

const { defineTask, getContext } = createContext<AppContext>({
  greeting: 'Hello'
});

// After: defineTask makes context implicit
const greet = defineTask(async (name: string) => {
  const { greeting } = getContext();  // Context is now available via getContext()
  return `${greeting}, ${name}!`;
});
```

**The Smart Way (Best of Both Worlds):**
```typescript
import { defineTask, getContext, run } from '@doeixd/effectively';

// This task works in ANY context - it adapts automatically!
const smartGreet = defineTask(async (name: string) => {
  const context = getContext(); // Smart: uses current context or global default
  const greeting = (context as any).greeting || 'Hello';
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
const fetchUser = defineTask(async (userId: string) => {
  const { api } = getContext();
  return api.getUser(userId);
});

const enrichUser = defineTask(async (user: User) => {
  const { api } = getContext();
  const profile = await api.getProfile(user.id);
  return { ...user, profile };
});

const formatUser = defineTask(async (enrichedUser: EnrichedUser) => {
  return `${enrichedUser.name} (${enrichedUser.profile.title})`;
});

// Chain them together into a workflow
const getUserDisplay = createWorkflow(
  fetchUser,
  enrichUser,
  formatUser
);
// This creates a new, single Task that runs all three in sequence.
```


#### Step 4: `run` Provides the Context

Tasks need a context to execute. The `run` function, created by `createContext`, provides it.

```typescript
import { createContext, type Scope } from '@doeixd/effectively';

// Define your context interface (scope is required)
interface AppContext {
  scope: Scope;  // Required by the library
  greeting: string;
  api: ApiClient;
}

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

#### Step 5: Effect Handlers

Here's where Effectively gets powerful: you can build **algebraic effect handlers** on top of the context system. These allow you to define abstract effects (like "get user input" or "log a message") and provide different implementations in different contexts.

```typescript
// Define an effect interface
interface Effects {
  input: (prompt: string) => Promise<string>;
  log: (message: string) => Promise<void>;
}

// A task that uses effects abstractly
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

Algebraic effect handlers let you write code that's abstract over side effects, making it highly testable and composable. The context system naturally provides this capability without additional complexity.

This simple, layered approach—from plain async functions to composable workflows with effect handlers—is the core of Effectively.

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

**Effect Handlers** enable algebraic effects through the context system, allowing you to write code that's abstract over side effects. **Brackets** provide guaranteed resource cleanup using the acquire-use-release pattern, ensuring resources are properly disposed of even when errors occur.

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

<br />

## 🚀 Features

### Guaranteed Resource Cleanup

Never leak resources again with the `bracket` pattern, which ensures a `release` function is always called, even if the `use` function throws an error. For detailed resource management patterns, see the [Bracket Resource Management Guide](docs/bracket-resource-management.md).

```typescript
const processFile = bracket({
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

## 🤔 Comparisons & Where It Fits

Effectively is a powerful tool, but it's important to understand when other approaches might be a better fit. For a detailed exploration of the motivation behind Effectively and how it compares to other patterns, see [Why Effectively?](docs/why-effectively.md).

### Plain `async/await` & Native Promises

**Use When:**
- You have simple scripts with no complex dependencies.
- You're building a library with minimal dependencies and zero overhead is critical.
- Your async logic is straightforward with simple error handling.

**Why:** For simple cases, plain `async/await` is more direct. Effectively enhances `async/await` for complex applications but isn't meant to replace it everywhere.

### Effect-TS or fp-ts

**Use When:**
- Your team is fully committed to pure functional programming.
- You need the power of a fiber-based runtime with true delimited continuations.
- You want compile-time guarantees for *all* effects.

| Aspect             | **Effectively**                                  | **[Effect-TS](https://effect.website)**                                | **[Tinyeffect](https://github.com/Snowflyt/tinyeffect)**                               |
| ------------------ | ------------------------------------------------ | -------------------------------------------- | -------------------------------------------- |
| **Philosophy**     | Enhance `async/await`                            | Replace the async foundation                 | Algebraic effects with generators            |
| **Learning Curve** | Low (builds on existing knowledge)               | High (new programming model)                 | Medium (generator-based effects)             |
| **Integration**    | Seamless with existing Promise-based code        | Requires wrapping code in the `Effect` runtime | Requires generator functions with `yield*`   |
| **Best For**       | Teams wanting better patterns with low overhead  | Teams wanting maximum purity and type safety | Teams wanting unified effect handling        |

### Tinyeffect

**Use When:**
- You want to handle all side effects (errors, async, dependencies) in a unified way.
- You need type-safe effect handling with explicit effect signatures.
- You're comfortable with generator functions and `yield*` syntax.
- You want algebraic effects without the complexity of a full FP ecosystem.

**Why:** Tinyeffect provides true algebraic effects for TypeScript, allowing you to model all side effects uniformly. Effects are typed and must be handled explicitly, preventing unhandled cases at compile time.

### [RxJS](https://rxjs.dev/)

**Use When:**
- Your application is primarily reactive and event-driven.
- You are dealing with complex event streams (e.g., UI events, WebSockets).
- You need powerful stream operators like `debounce`, `throttle`, `buffer`, etc.

**Why:** RxJS is purpose-built for reactive programming and managing streams of events over time. Effectively is designed for managing workflows with a clear start and end.

### Synchronous Code

**Use When:**
- Your code doesn't involve I/O or other asynchronous operations.
- You are performing pure computations on in-memory data.

**Why:** Async has overhead. Don't introduce the complexity of `async/await` or Effectively if your function is synchronous.

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

### Smart Context System

For a comprehensive guide to the smart context system with smart, local-only, and global-only functions, see the [Context System Guide](docs/context-system.md). This covers when to use each variant, migration strategies, and best practices for different use cases.

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

<br />

## 🧰 API Reference

### Core Engine

#### Context Creation
| Function | Description |
|----------|-------------|
| `createContext<C>(defaults)` | Creates a new, isolated system with its own `run`, `getContext`, etc. |

#### Smart Context Functions (recommended)
| Function | Description |
|----------|-------------|
| `defineTask<V, R>(fn)` | **Smart**: Defines a task using current context if available, otherwise global default. |
| `getContext<C>()` | **Smart**: Gets current context if available, otherwise global default. Supports generics for type safety. |
| `getContextSafe<C>()` | **Smart**: Returns `Result<Context, Error>` instead of throwing. |
| `getContextOrUndefined<C>()` | **Smart**: Returns context or `undefined`, never throws. |
| `run<V, R>(task, value, options?)` | **Smart**: Executes a workflow using current context if available, otherwise global default. |
| `provide(overrides, fn)` | **Smart**: Temporarily modifies context, adapts to current context. |

#### Local-Only Context Functions (current context required)
| Function | Description |
|----------|-------------|
| `defineTaskLocal<C, V, R>(fn)` | **Local**: Only works within an active context, throws if no context available. |
| `getContextLocal<C>()` | **Local**: Gets current context, throws if no context available. |
| `getContextSafeLocal<C>()` | **Local**: Returns `Result<Context, Error>`, error if no context available. |
| `getContextOrUndefinedLocal<C>()` | **Local**: Returns context or `undefined`, never uses global fallback. |
| `runLocal<C, V, R>(task, value, options?)` | **Local**: Executes workflow in current context only, throws if no context. |
| `provideLocal<C, R>(overrides, fn)` | **Local**: Modifies current context only, throws if no context available. |

#### Global-Only Context Functions (explicit global usage)
| Function | Description |
|----------|-------------|
| `defineTaskGlobal<V, R>(fn)` | **Global**: Always uses global default context, ignores current context. |
| `getContextGlobal()` | **Global**: Always gets global default context. |
| `runGlobal<V, R>(task, value, options?)` | **Global**: Always executes in global default context. |
| `provideGlobal<R>(overrides, fn)` | **Global**: Always modifies global default context. |

### Composition & Utilities
| Function | Pattern | Description |
|----------|---------|-------------|
| `createWorkflow(...tasks)` | Standalone | Chains tasks into a sequential workflow. |
| `pipe(value, ...fns)` | Standalone | Generic utility for function composition. |
| `map(fn)` | Pipeable | Transforms values in a workflow. |
| `flatMap(fn)` | Pipeable | Transforms values into new Tasks. |
| `tap(fn)` | Pipeable | Side effects without changing the value. |
| `fromValue(value)` | Standalone | Starts a workflow with a static value. |
| `fromPromise(promise)` | Standalone | Starts a workflow from a Promise. |

### Do-Notation & Monadic Composition
| Function | Description |
|----------|-------------|
| `doTask(generatorFn)` | Enables Haskell-style do-notation using generators for monadic composition. |
| `pure(value)` | Lifts plain values into the monadic context, useful in do-blocks. |
| `createDoNotation<C>()` | Creates context-specific do notation functions with better type inference. |
| `call(task, input)` | Helper to call a task with specific input parameters in do notation. |
| `doWhen(condition, onTrue, onFalse)` | Conditional monadic execution based on a boolean condition. |
| `doUnless(condition, action)` | Maybe-like conditional execution - only runs if condition is false. |
| `sequence(monadicValues[])` | Executes multiple monadic values in sequence and collects results. |
| `forEach(items, action)` | Loops over an array, executing a monadic function for each element. |

### Error Handling
| Function | Description |
|----------|-------------|
| `withErrorBoundary(task, handlers)` | Catches and handles thrown errors with type-safe handlers. |
| `createErrorHandler(...tuples)` | Creates handler tuples for `withErrorBoundary`. |
| `createErrorType(options)` | Factory for custom error classes with inheritance. |
| `tryCatch(fn)` | Converts throwing functions to `Result`-returning ones. |

### Resource Management
| Function | Description |
|----------|-------------|
| `bracket({ acquire, use, release })` | Guarantees resource cleanup with acquire-use-release pattern. |
| `resource({ acquire, use, release })` | Alias for `bracket` - same guaranteed resource cleanup functionality. |
| `bracketDisposable({ acquire, use })` | For resources with `Symbol.dispose` or `Symbol.asyncDispose`. |
| `bracketMany(configs, use)` | Manages multiple resources, releases in reverse order. |

### Resilience Patterns
| Function | Description |
|----------|-------------|
| `withRetry(task, options)` | Automatic retries with configurable backoff strategies. |
| `withTimeout(task, ms)` | Time limits for task execution. |
| `withCircuitBreaker(task, options)` | Prevents cascading failures with circuit breaker pattern. |
| `withDebounce(task, ms)` | Ensures task only runs after period of inactivity. |

### Concurrency & Parallelism
| Function | Pattern | Description |
|----------|---------|-------------|
| `forkJoin({ a: taskA, b: taskB })` | Pipeable | Parallel execution with named results. |
| `allTuple([task1, task2])` | Standalone | Returns typed tuple of parallel results. |
| `ift(predicate, onTrue, onFalse)` | Pipeable | Conditional branching in workflows. |
| `mapReduce(items, mapper, reducer, initial)` | Standalone | Parallel map, sequential reduce. |
| `stream(tasks, value, options)` | Standalone | Memory-efficient streaming execution. |

### Control Flow
| Class/Function | Description |
|----------------|-------------|
| `BacktrackSignal(target, value)` | Signal to jump back to a previous task in workflow. |
| `isBacktrackSignal(error)` | Type guard for backtrack signals. |
| `WorkflowError` | Structured error with task context information. |

### Multi-Threading (Web Workers)
| Function | Side | Description |
|----------|------|-------------|
| `createWorkerHandler(tasks)` | Worker | Sets up worker to handle main thread requests. |
| `runOnWorker(worker, taskId)` | Main | Executes task on worker (request-response). |
| `runStreamOnWorker(worker, taskId)` | Main | Streams results from worker task. |

### Context & Dependency Injection
| Function | Description |
|----------|-------------|
| `mergeContexts(contextA, contextB)` | Type-safe context merging, with B taking precedence. |
| `validateContext(schema, context)` | Runtime context validation using provided schema. |
| `requireContextProperties(...keys)` | Throws if required context properties are missing. |
| `createInjectionToken<T>(description)` | Creates type-safe dependency injection tokens. |
| `inject(token)` | Injects a dependency by its token from current context. |
| `injectOptional(token)` | Safely injects a dependency, returns undefined if not found. |
| `withContextEnhancement(enhancement, task)` | Provides additional context to a child task. |

### Advanced Context Tools
| Function | Description |
|----------|-------------|
| `createContextTransformer(transformer)` | Creates reusable context transformation functions. |
| `useContextProperty(key)` | Type-safe accessor for specific context properties. |
| `withScope(providers, task)` | Temporarily provides additional services in scope. |
| `createLazyDependency(factory)` | Creates dependencies that are only instantiated when accessed. |

### OpenTelemetry Integration
| Function | Description |
|----------|-------------|
| `withSpan(task, options)` | Wraps task with OpenTelemetry span or fallback logging. |
| `recordMetric(context, type, options, value)` | Records counter, histogram, or gauge metrics. |
| `withObservability(task, options)` | Complete observability with tracing, timing, and counting. |
| `withTiming(task, metricName)` | Measures and records task execution time. |
| `withCounter(task, counterName)` | Counts successful and failed task executions. |
| `addSpanAttributes(context, attributes)` | Adds structured data to current span. |
| `recordSpanException(context, error)` | Records exceptions in current span. |
| `createTelemetryContext(providers)` | Creates context with tracer/meter/logger providers. |
| `@traced(spanName?)` | Decorator for automatic method tracing. |

For detailed telemetry setup and configuration, see the [OpenTelemetry Integration Guide](docs/telemetry.md).

<br />

## 🤝 Contributing

We welcome contributions! Check our [Contributing Guide](CONTRIBUTING.md) for details.

<br />

## 📄 License

MIT - Use freely in your projects.
