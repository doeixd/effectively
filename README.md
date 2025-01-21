# Effectively 🚂
A lightweight, type-safe effect system for TypeScript inspired by algebraic effects, featuring built-in concurrency primitives and error handling.

## Overview
Effectively separates effects (what you want to do) from their implementation (how you want to do it). It includes priority-based scheduling, error handling, and concurrency primitives like retries and rate limiting. Aiming to be useful, and easy to understand.

## Features
- 🎯 Type-safe effect definitions and handlers
- 📊 Priority-based task scheduling
- 🔄 Continuations for complex flows
- 🛡️ Sophisticated error handling with inheritance
- 🚦 Concurrency primitives (retry, rate limiting)
- 🎛️ Multiple backoff strategies
- 🧩 Composable effects
- ⚡ Async/await support

## Installation
```bash
npm install effectively
```

## Basic Usage

```typescript
import { defineEffect, defineHandler, contextRoot } from 'effectively'

// Define an effect
const log = defineEffect<(message: string) => void>('log')

// Create a effect context
await contextRoot(async () => {

  // Define how the effect should be handled
  defineHandler('log', (message: string) => {

    console.log(`[${new Date().toISOString()}] ${message}`)

  })

  // Use the effect
  await log('Hello, effectively!')
})
```

## Error Handling
Handle different types of errors with specific handlers:

```typescript
import { registerErrorHandler } from 'effectively'

class ValidationError extends Error {}
class DatabaseError extends Error {}

await contextRoot(async () => {
  // Register type-specific error handlers
  registerErrorHandler(ValidationError, async (error) => {
    console.log('Validation failed:', error.message)
  })

  registerErrorHandler(DatabaseError, async (error) => {
    console.error('Database error:', error.message)
    await notifyAdmin(error)
  })

  // Errors will be automatically routed to appropriate handlers
  try {
    await saveUser(user)
  } catch (error) {
    // Error has been handled, but we can still catch if needed
  }
})
```

## Concurrency Primitives
Built-in support for retries, backoff, and rate limiting:

```typescript
import { retry, rateLimit, backoff, combinedEffect } from 'effectively'

await contextRoot(async () => {
  // Retry with exponential backoff
  const result = await retry(
    async () => fetchData(),
    {
      maxAttempts: 5,
      backoff: backoff.exponential(1000),
      shouldRetry: (error) => error instanceof NetworkError
    }
  )

  // Rate limiting
  const rateLimitedApi = await rateLimit(
    async () => callApi(),
    {
      maxRequests: 100,
      timeWindow: 60000, // 1 minute
      fairness: true
    }
  )

  // Combine multiple effects
  const resilientApi = await combinedEffect(
    [
      (op) => retry(op, { maxAttempts: 3 }),
      (op) => rateLimit(op, { maxRequests: 100, timeWindow: 60000 })
    ],
    async () => fetchApi()
  )
})
```

## Backoff Strategies
Multiple built-in strategies for retry backoff:

```typescript
import { backoff, withJitter } from 'effectively'

// Available strategies
const constantBackoff = backoff.constant(1000)
const linearBackoff = backoff.linear(1000)
const exponentialBackoff = backoff.exponential(1000)
const fibonacciBackoff = backoff.fibonacci(1000)

// Add jitter to any strategy
const jitteredBackoff = withJitter(exponentialBackoff)
```

## Priority-based Scheduling
Tasks can be scheduled with different priorities:

```typescript
defineHandler('criticalOperation', async () => {
  // Important operation
}, 'high')

defineHandler('backgroundTask', async () => {
  // Less important task
}, 'low')

// Or use numeric priorities
defineHandler('mediumPriority', async () => {
  // Something in between
}, 1)
```

## Advanced Features

### Custom Effect Context
```typescript
interface MyEffectContext extends EffectContext {
  handlers: {
    log: (message: string) => void
    saveUser: (user: User) => Promise<User>
  }
}

const customContext = createDefaultEffectContext<MyEffectContext>()
await contextRoot(myFunction, customContext)
```

### Scheduler Control
```typescript
const ctx = getEffectContext()
ctx.runtime.scheduler.pause()  // Pause task processing
// ... do something ...
ctx.runtime.scheduler.resume() // Resume task processing
```

## API Reference

### Core
- `defineEffect(name, defaultHandler?)`: Create a new effect
- `defineHandler(name, handler, priority?)`: Define effect handler
- `contextRoot(callback, context?)`: Create effect context
- `getEffectContext()`: Get current context

### Error Handling
- `registerErrorHandler(errorType, handler)`: Register type-specific error handler
- `handleError(error)`: Handle an error with registered handlers

### Concurrency
- `retry(operation, options)`: Retry an operation with backoff
- `rateLimit(operation, options)`: Rate limit operations
- `combinedEffect(operators, operation)`: Combine multiple effects
- `backoff`: Various backoff strategies

### Types
- `Priority`: `'high' | 'medium' | 'low' | number`
- `RetryOptions`: Configuration for retry behavior
- `RateLimitOptions`: Configuration for rate limiting
- `EffectContext`: Context type for effects
- `ErrorHandler`: Type for error handlers

## Contributing
Contributions are welcome! Please feel free to submit a Pull Request.

## License
MIT
