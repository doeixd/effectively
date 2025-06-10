![npm](https://img.shields.io/npm/v/effectively)
![license](https://img.shields.io/npm/l/effectively)
<style>
  h1,h2,h3,h4,h5,h6 {
    padding-top: 1.5lh
  }
</style>
# Effectively 🚂

**Build resilient TypeScript applications without the complexity.**

Effectively is a lightweight toolkit that brings structure and safety to asynchronous TypeScript code. It feels like a natural extension of `async/await`, not a replacement for it.

## 🎯 Why Effectively?

**The Problem:** Modern TypeScript applications face real challenges:
- Unhandled errors crash production systems
- Dependency injection becomes a tangled mess
- Testing async code requires extensive mocking
- Resource leaks from unclosed connections
- No standard patterns for retries, timeouts, or circuit breakers

**The Solution:** Effectively provides battle-tested patterns for these problems without forcing you to learn a new programming paradigm. If you can write `async/await`, you can use Effectively.

## 📦 Installation

```bash
npm install effectively neverthrow
```

*Note: `neverthrow` is a peer dependency for typed error handling.*

<br />

## 🚀 Understanding the Core Intuition: A Getting Started Guide

At its heart, Effectively is beautifully simple. Let's build your understanding from the ground up.

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

```typescript
import { defineTask, getContext } from 'effectively';

// Before: explicit context parameter
async function greetExplicit(context: AppContext, name: string) {
  return `${context.greeting}, ${name}!`;
}

// After: defineTask makes context implicit
const greet = defineTask(async (name: string) => {
  const { greeting } = getContext();  // Context is now available via getContext()
  return `${greeting}, ${name}!`;
});
```

That's it! **`defineTask` doesn't do anything magical**—it just wraps your function to handle the context parameter for you, making your code cleaner.

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
import { createContext } from 'effectively';

// Create your app's context with default dependencies
const { run } = createContext({
  greeting: 'Hello',
  api: myApiClient
});

// Run a single task
const message = await run(greet, 'World');

// Run a workflow (which is also just a Task!)
const display = await run(getUserDisplay, 'user-123');
```

This simple, layered approach—from plain async functions to composable workflows—is the core of Effectively.

## 💡 Core Concepts

Now that you have the intuition, let's formalize the key concepts:

### 1. Tasks: Your Building Blocks

A **Task** is the atomic unit of work. As you've seen, it's an async function made composable by `defineTask`. This makes dependencies explicit and your code testable.

### 2. Workflows: Composition Made Simple

A **Workflow** chains Tasks together. `createWorkflow` creates a new Task where the output of one becomes the input of the next.

**Visual Flow:**
`CardInput → [validateCard] → ValidCard → [chargeCard] → ChargeResult → [sendReceipt] → Receipt`

### 3. Context: Clean Dependency Injection

**Context** provides your dependencies (like API clients, loggers, or config) without prop drilling or global state. It's provided once by `run` and easily mocked for tests.

## 🛡️ Error Handling: A Dual Strategy

Effectively promotes two complementary approaches to error handling:

### 1. Domain Errors: Use `Result<T, E>`

For expected failures that are part of your business logic (e.g., validation errors), use the `Result` type from `neverthrow`. This forces you to handle potential failures at compile time.

```typescript
import { Result, ok, err } from 'neverthrow';

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

## 🚀 Production-Ready Features

### Guaranteed Resource Cleanup

Never leak resources again with the `bracket` pattern, which ensures a `release` function is always called, even if the `use` function throws an error.

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
  maxAttempts: 3,
  delay: { type: 'exponential', initial: 1000 }
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

Go beyond `Promise.all` with named results, partial failure handling, and efficient data processing.

```typescript
// Parallel execution with named results
const results = await run(
  pipe(
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

## 🤔 Comparisons & Where It Fits

Effectively is a powerful tool, but it's important to understand when other approaches might be a better fit.

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

| Aspect             | **Effectively**                                  | **Effect-TS**                                |
| ------------------ | ------------------------------------------------ | -------------------------------------------- |
| **Philosophy**     | Enhance `async/await`                            | Replace the async foundation                 |
| **Learning Curve** | Low (builds on existing knowledge)               | High (new programming model)                 |
| **Integration**    | Seamless with existing Promise-based code        | Requires wrapping code in the `Effect` runtime |
| **Best For**       | Teams wanting better patterns with low overhead  | Teams wanting maximum purity and type safety |

### RxJS

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

## 🧠 Advanced Concepts

### Non-Linear Control Flow: Backtracking

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

### Concurrency: Leveraging the Platform

Effectively embraces the browser and Node.js's native concurrency primitives rather than reimplementing them. This means it uses `scheduler.postTask` when available for cooperative multitasking, and you can leverage `SharedArrayBuffer` and `Atomics` when using the Web Worker integration for true parallelism.

## 📚 Guides & Deeper Dives

### Performance & Debugging

Pass a logger to the `run` function to get detailed insight into your workflow's execution, including task timing and success/failure states. For large datasets, use `stream()` or `mapReduce()` with a `concurrency` limit to process data efficiently without overwhelming the system.

### Setting Up Web Workers

Offload CPU-intensive work to a separate thread without the usual boilerplate.

**1. Worker File (`worker.ts`)**
```typescript
import { createWorkerHandler, defineTask } from 'effectively/worker';

const heavyCalculation = defineTask(async (data: number[]) => {
  // ... intensive processing
  return processedData;
});

createWorkerHandler({ heavyCalculation });
```

**2. Main Thread (`main.ts`)**
```typescript
import { runOnWorker } from 'effectively';

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

## 📋 Best Practices

- **Keep Tasks Focused:** Each task should have a single responsibility. Compose them in workflows rather than creating monolithic tasks.
- **Use `Result` for Domain Errors:** Use `neverthrow`'s `Result` type for predictable errors (e.g., validation), forcing compile-time checks.
- **Use `withErrorBoundary` for System Errors:** Reserve throwing and error boundaries for unexpected system failures (e.g., network loss).
- **Define Clear Context Interfaces:** Keep your `AppContext` clean and well-defined. Pass request-specific data through the workflow, not in the context.
- **Always Use `bracket` for Resources:** Guarantee cleanup for files, database connections, or other resources that need explicit closing.

## ⚠️ Common Pitfalls & Solutions

- **`ContextNotFoundError`:** You called `getContext()` outside of a task's execution. Ensure it's called inside the async function passed to `defineTask`.
- **Enhancer Not Working:** Enhancers (`withRetry`, `withTimeout`, etc.) return a *new* task. You must use the returned value. `const retried = withRetry(myTask);` not `withRetry(myTask);`.
- **Backtracking Not Working:** The target task was not created with `defineTask`. The runtime needs the `__task_id` assigned by `defineTask` to find it.
- **Workflow Stops Midway:** An unhandled error was likely thrown. Debug by running with `{ throw: false }` to inspect the returned `Result` object: `const result = await run(workflow, input, { throw: false });`.

## 🧰 Complete API Reference

### Core Engine
| Function | Description |
|----------|-------------|
| `createContext<C>(defaults)` | Creates a new, isolated system with its own `run`, `getContext`, etc. |
| `run<V, R>(task, value, options?)` | Executes a workflow `Task`. The heart of the library. |
| `defineTask<V, R>(fn)` | Defines a function as a `Task` with a unique `__task_id` for backtracking. |
| `getContext()` | Retrieves the current workflow's context. Must be called within `run`. |
| `getContextSafe()` | Returns a `Result<Context, Error>` instead of throwing. |
| `getContextOrUndefined()` | Returns context or `undefined`, never throws. |
| `provide(overrides, fn)` | Executes a function with temporarily modified context. |

### Composition & Utilities
| Function | Pattern | Description |
|----------|---------|-------------|
| `createWorkflow(...tasks)` | Standalone | Chains tasks into a sequential workflow. |
| `pipe` | Standalone | Generic utility for function composition. |
| `map(fn)` | Pipeable | Transforms values in a workflow. |
| `flatMap(fn)` | Pipeable | Transforms values into new Tasks. |
| `tap(fn)` | Pipeable | Side effects without changing the value. |
| `fromValue(value)` | Standalone | Starts a workflow with a static value. |
| `fromPromise(promise)` | Standalone | Starts a workflow from a Promise. |

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

## 🤝 Contributing

We welcome contributions! Check our [Contributing Guide](CONTRIBUTING.md) for details.

## 📄 License

MIT - Use freely in your projects.
