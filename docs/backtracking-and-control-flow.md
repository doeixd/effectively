# Backtracking and Non-Linear Control Flow

## Overview

Effectively provides powerful non-linear control flow capabilities through its **backtracking system**. Unlike traditional linear execution where functions call forward and return backward, Effectively allows workflows to "jump back" to previously executed tasks. This enables sophisticated patterns like retries, polling, state machines, and adaptive workflows.

## Core Concept: BacktrackSignal

The foundation of non-linear control flow is the `BacktrackSignal` - a special error that tells the runtime to jump back to a specific task with new input:

```typescript
import { defineTask, BacktrackSignal } from '@doeixd/effectively';

const retryableTask = defineTask(async (attempt: number) => {
  const result = await riskyOperation();
  
  if (result.needsRetry && attempt < 3) {
    // Jump back to this same task with incremented attempt
    throw new BacktrackSignal(retryableTask, attempt + 1);
  }
  
  return result;
});
```

### Key Requirements

1. **Tasks must be created with `defineTask`**: The runtime needs the unique `__task_id` assigned by `defineTask` to locate the target task
2. **Target task must exist in the current workflow**: You can only backtrack to tasks that have already been executed in the current workflow
3. **New input must match the task's expected type**: The value provided to `BacktrackSignal` becomes the new input to the target task

## Memory Management with Backtracking

### No State Accumulation

Effectively's design ensures that backtracking doesn't cause memory leaks:

```typescript
const pollingTask = defineTask(async (params: { jobId: string; attempt: number }) => {
  const { api, logger } = getContext();
  
  // Each execution gets fresh local variables - no accumulation
  const startTime = Date.now();
  const result = await api.checkJobStatus(params.jobId);
  
  if (!result.isComplete) {
    // Log and cleanup happen normally
    logger.debug(`Attempt ${params.attempt} incomplete, retrying...`);
    
    const backoffMs = Math.min(1000 * Math.pow(2, params.attempt), 30000);
    await new Promise(res => setTimeout(res, backoffMs));
    
    // Jump back - previous execution context is fully cleaned up
    throw new BacktrackSignal(pollingTask, {
      jobId: params.jobId,
      attempt: params.attempt + 1
    });
  }
  
  return result.data;
});
```

**Key Points:**
- Each backtrack creates a completely new execution context
- Local variables from previous attempts are garbage collected
- No hidden state accumulates between iterations
- Memory usage remains constant regardless of retry count

### Context Lifecycle

The context system works seamlessly with backtracking:

```typescript
const contextAwareTask = defineTask(async (data: ProcessingData) => {
  const { database, cache, logger } = getContext();
  
  // Fresh context access on each backtrack
  const transaction = await database.beginTransaction();
  
  try {
    const result = await processData(data, transaction);
    
    if (result.needsRetry) {
      // Cleanup current attempt before backtracking
      await transaction.rollback();
      throw new BacktrackSignal(contextAwareTask, data.withRetry());
    }
    
    await transaction.commit();
    return result;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
});
```

## Cancellation and Backtracking

### Scope-Based Cancellation

Backtracking works with Effectively's scope-based cancellation system:

```typescript
const cancellablePolling = defineTask(async (params: { jobId: string }) => {
  const { scope } = getContext();
  
  // Check cancellation before each operation
  scope.throwIfCancelled();
  
  const result = await api.checkJobStatus(params.jobId);
  
  if (!result.isComplete) {
    // Check cancellation before backtracking
    scope.throwIfCancelled();
    
    await sleep(1000);
    throw new BacktrackSignal(cancellablePolling, params);
  }
  
  return result;
});

// Usage with timeout and cancellation
const { cancel } = await runWithTimeout(cancellablePolling, { jobId: '123' }, 30000);

// Cancel from elsewhere
setTimeout(() => cancel(), 15000);
```

### Cancellation During Backtrack

When a scope is cancelled during backtracking:

1. **Current execution stops immediately** if checking cancellation
2. **Pending backtracks are abandoned** - the signal is not processed
3. **Cleanup runs normally** through finally blocks and bracket patterns
4. **AbortError is thrown** instead of continuing the backtrack

## Resource Management with Brackets

### Safe Resource Handling

The bracket pattern ensures resources are cleaned up even when backtracking:

```typescript
const resourceUsingTask = defineTask(async (attempt: number) => {
  return bracket({
    acquire: () => openDatabase(),
    
    use: async (db) => {
      const result = await db.query('SELECT * FROM jobs WHERE status = ?', ['pending']);
      
      if (result.length === 0 && attempt < 5) {
        // Resource will be cleaned up before backtracking
        throw new BacktrackSignal(resourceUsingTask, attempt + 1);
      }
      
      return result;
    },
    
    release: (db) => db.close() // Always runs, even on backtrack
  });
});
```

### Multiple Resource Coordination

```typescript
const multiResourceTask = defineTask(async (data: WorkData) => {
  return bracketMany([
    { acquire: () => openDatabase(), release: (db) => db.close() },
    { acquire: () => createTempFile(), release: (file) => file.delete() },
    { acquire: () => acquireLock(data.id), release: (lock) => lock.release() }
  ], async ([db, tempFile, lock]) => {
    
    const result = await processWithResources(data, db, tempFile, lock);
    
    if (result.needsRetry) {
      // All resources cleaned up automatically before backtrack
      throw new BacktrackSignal(multiResourceTask, data.withRetry());
    }
    
    return result;
  });
});
```

## Advanced Backtracking Patterns

### State Machine Implementation

```typescript
type FSMState = 'init' | 'processing' | 'validating' | 'complete' | 'failed';

interface FSMData {
  state: FSMState;
  data: any;
  retries: number;
}

const stateMachineTask = defineTask(async ({ state, data, retries }: FSMData) => {
  const { logger } = getContext();
  
  switch (state) {
    case 'init':
      logger.info('Initializing...');
      const initData = await initialize(data);
      throw new BacktrackSignal(stateMachineTask, {
        state: 'processing',
        data: initData,
        retries
      });
      
    case 'processing':
      logger.info('Processing...');
      try {
        const processed = await process(data);
        throw new BacktrackSignal(stateMachineTask, {
          state: 'validating',
          data: processed,
          retries
        });
      } catch (error) {
        if (retries < 3) {
          throw new BacktrackSignal(stateMachineTask, {
            state: 'processing',
            data,
            retries: retries + 1
          });
        }
        throw new BacktrackSignal(stateMachineTask, {
          state: 'failed',
          data: { error },
          retries
        });
      }
      
    case 'validating':
      logger.info('Validating...');
      const isValid = await validate(data);
      if (isValid) {
        throw new BacktrackSignal(stateMachineTask, {
          state: 'complete',
          data,
          retries
        });
      } else {
        throw new BacktrackSignal(stateMachineTask, {
          state: 'processing',
          data,
          retries: retries + 1
        });
      }
      
    case 'complete':
      logger.info('Complete!');
      return data;
      
    case 'failed':
      logger.error('Failed after retries');
      throw new Error('Processing failed');
      
    default:
      throw new Error(`Unknown state: ${state}`);
  }
});
```

### Adaptive Retry with Exponential Backoff

```typescript
interface RetryParams {
  operation: () => Promise<any>;
  attempt: number;
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const adaptiveRetryTask = defineTask(async (params: RetryParams) => {
  const { logger } = getContext();
  
  try {
    const result = await params.operation();
    logger.info(`Operation succeeded on attempt ${params.attempt}`);
    return result;
    
  } catch (error) {
    if (params.attempt >= params.maxAttempts) {
      logger.error(`Operation failed after ${params.maxAttempts} attempts`);
      throw error;
    }
    
    // Calculate exponential backoff with jitter
    const baseDelay = params.baseDelayMs * Math.pow(2, params.attempt - 1);
    const jitter = Math.random() * 0.1 * baseDelay;
    const delayMs = Math.min(baseDelay + jitter, params.maxDelayMs);
    
    logger.warn(`Attempt ${params.attempt} failed, retrying in ${delayMs}ms`, { error });
    
    await sleep(delayMs);
    
    throw new BacktrackSignal(adaptiveRetryTask, {
      ...params,
      attempt: params.attempt + 1
    });
  }
});
```

### Circuit Breaker with Backtracking

```typescript
interface CircuitState {
  status: 'closed' | 'open' | 'half-open';
  failures: number;
  lastFailure?: Date;
  threshold: number;
  timeout: number;
}

const circuitBreakerTask = defineTask(async (params: { 
  operation: () => Promise<any>, 
  circuit: CircuitState 
}) => {
  const { operation, circuit } = params;
  const now = new Date();
  
  // Check if circuit should transition from open to half-open
  if (circuit.status === 'open') {
    const timeSinceFailure = circuit.lastFailure 
      ? now.getTime() - circuit.lastFailure.getTime()
      : 0;
      
    if (timeSinceFailure >= circuit.timeout) {
      // Transition to half-open
      throw new BacktrackSignal(circuitBreakerTask, {
        operation,
        circuit: { ...circuit, status: 'half-open' }
      });
    } else {
      throw new Error('Circuit breaker is open');
    }
  }
  
  try {
    const result = await operation();
    
    // Success - close circuit if it was half-open
    if (circuit.status === 'half-open') {
      throw new BacktrackSignal(circuitBreakerTask, {
        operation: () => Promise.resolve(result),
        circuit: { ...circuit, status: 'closed', failures: 0 }
      });
    }
    
    return result;
    
  } catch (error) {
    const newFailures = circuit.failures + 1;
    
    if (newFailures >= circuit.threshold) {
      // Open the circuit
      throw new BacktrackSignal(circuitBreakerTask, {
        operation,
        circuit: {
          ...circuit,
          status: 'open',
          failures: newFailures,
          lastFailure: now
        }
      });
    } else {
      // Increment failure count and retry
      throw new BacktrackSignal(circuitBreakerTask, {
        operation,
        circuit: { ...circuit, failures: newFailures }
      });
    }
  }
});
```

## Performance Considerations

### Direct Function Calls

Effectively doesn't use trampolining, which means:

```typescript
// ✅ Excellent performance - direct function calls
const fastBacktrack = defineTask(async (n: number) => {
  if (n > 0) {
    throw new BacktrackSignal(fastBacktrack, n - 1);
  }
  return n;
});

// Stack traces remain clear and debugging is straightforward
```

### Memory Efficiency

```typescript
// ✅ Memory efficient - no accumulation
const memoryEfficientLoop = defineTask(async (params: { 
  items: string[], 
  index: number,
  processed: number 
}) => {
  const { items, index, processed } = params;
  
  if (index >= items.length) {
    return { totalProcessed: processed };
  }
  
  // Process one item
  await processItem(items[index]);
  
  // Continue with next item - previous context is cleaned up
  throw new BacktrackSignal(memoryEfficientLoop, {
    items,
    index: index + 1,
    processed: processed + 1
  });
});
```

### Avoiding Infinite Loops

```typescript
// ✅ Bounded backtracking
const boundedRetry = defineTask(async (params: { 
  operation: () => Promise<any>,
  attempt: number,
  maxAttempts: number 
}) => {
  if (params.attempt > params.maxAttempts) {
    throw new Error(`Max attempts (${params.maxAttempts}) exceeded`);
  }
  
  try {
    return await params.operation();
  } catch (error) {
    throw new BacktrackSignal(boundedRetry, {
      ...params,
      attempt: params.attempt + 1
    });
  }
});
```

## Debugging Backtracking

### Adding Observability

```typescript
const observableTask = defineTask(async (attempt: number) => {
  const { logger } = getContext();
  
  logger.debug('Task execution', { 
    taskName: 'observableTask',
    attempt,
    timestamp: new Date().toISOString()
  });
  
  try {
    const result = await riskyOperation();
    
    if (result.needsRetry && attempt < 3) {
      logger.info('Backtracking', { 
        from: 'observableTask',
        to: 'observableTask',
        newAttempt: attempt + 1
      });
      
      throw new BacktrackSignal(observableTask, attempt + 1);
    }
    
    logger.debug('Task completed', { 
      taskName: 'observableTask',
      attempt,
      result: result.id
    });
    
    return result;
  } catch (error) {
    if (error instanceof BacktrackSignal) {
      throw error; // Re-throw backtrack signals
    }
    
    logger.error('Task failed', { 
      taskName: 'observableTask',
      attempt,
      error: error.message
    });
    throw error;
  }
});
```

### Testing Backtracking Logic

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Backtracking', () => {
  it('should retry failed operations', async () => {
    let attempts = 0;
    const mockOperation = vi.fn().mockImplementation(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Temporary failure');
      }
      return { success: true, attempts };
    });
    
    const retryTask = defineTask(async (attempt: number) => {
      try {
        return await mockOperation();
      } catch (error) {
        if (attempt < 3) {
          throw new BacktrackSignal(retryTask, attempt + 1);
        }
        throw error;
      }
    });
    
    const result = await run(retryTask, 1);
    
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(3);
    expect(mockOperation).toHaveBeenCalledTimes(3);
  });
  
  it('should cleanup resources on backtrack', async () => {
    const cleanup = vi.fn();
    
    const resourceTask = defineTask(async (attempt: number) => {
      return bracket({
        acquire: () => ({ id: attempt }),
        use: async (resource) => {
          if (attempt < 2) {
            throw new BacktrackSignal(resourceTask, attempt + 1);
          }
          return resource;
        },
        release: cleanup
      });
    });
    
    const result = await run(resourceTask, 1);
    
    expect(result.id).toBe(2);
    expect(cleanup).toHaveBeenCalledTimes(2); // Once for each attempt
  });
});
```

## Best Practices

### 1. Always Bound Your Backtracks
```typescript
// ✅ Good - bounded
const safeBatrackTrack = defineTask(async (attempt: number) => {
  if (attempt > MAX_ATTEMPTS) {
    throw new Error('Max attempts exceeded');
  }
  // ... rest of logic
});

// ❌ Bad - potentially infinite
const dangerousBacktrack = defineTask(async (data: any) => {
  if (someCondition(data)) {
    throw new BacktrackSignal(dangerousBacktrack, data);
  }
  return data;
});
```

### 2. Use Meaningful State Types
```typescript
// ✅ Good - clear state modeling
interface RetryState {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly data: ProcessingData;
  readonly lastError?: Error;
}

// ❌ Bad - unclear state
const unclearBacktrack = defineTask(async (stuff: any) => {
  // What is stuff? Hard to reason about
});
```

### 3. Handle Cleanup Explicitly
```typescript
// ✅ Good - explicit cleanup
const cleanBacktrack = defineTask(async (params: TaskParams) => {
  return bracket({
    acquire: () => getResource(),
    use: async (resource) => {
      const result = await useResource(resource);
      if (needsRetry(result)) {
        throw new BacktrackSignal(cleanBacktrack, updateParams(params));
      }
      return result;
    },
    release: (resource) => resource.cleanup()
  });
});
```

### 4. Make Backtracking Observable
```typescript
// ✅ Good - observable backtracking
const observableBacktrack = defineTask(async (state: TaskState) => {
  const { logger, metrics } = getContext();
  
  logger.debug('Task attempt', { attempt: state.attempt });
  metrics.increment('task.attempts');
  
  try {
    const result = await performOperation(state);
    metrics.increment('task.success');
    return result;
  } catch (error) {
    if (shouldRetry(error, state)) {
      metrics.increment('task.retry');
      throw new BacktrackSignal(observableBacktrack, nextState(state));
    }
    metrics.increment('task.failure');
    throw error;
  }
});
```

## Comparison with Other Patterns

### vs. Traditional Recursion
```typescript
// Traditional recursion - can cause stack overflow
async function traditionalRetry(attempt: number): Promise<any> {
  try {
    return await riskyOperation();
  } catch (error) {
    if (attempt < 3) {
      return traditionalRetry(attempt + 1); // Grows stack
    }
    throw error;
  }
}

// Effectively backtracking - constant stack depth
const effectivelyRetry = defineTask(async (attempt: number) => {
  try {
    return await riskyOperation();
  } catch (error) {
    if (attempt < 3) {
      throw new BacktrackSignal(effectivelyRetry, attempt + 1); // Constant stack
    }
    throw error;
  }
});
```

### vs. Loops with State
```typescript
// Traditional loop - accumulates state
async function loopWithState() {
  let attempt = 1;
  let lastError;
  
  while (attempt <= 3) {
    try {
      return await riskyOperation();
    } catch (error) {
      lastError = error; // State accumulation
      attempt++;
    }
  }
  
  throw lastError;
}

// Effectively - no state accumulation
const effectivelyLoop = defineTask(async (attempt: number) => {
  try {
    return await riskyOperation();
  } catch (error) {
    if (attempt < 3) {
      throw new BacktrackSignal(effectivelyLoop, attempt + 1);
    }
    throw error;
  }
});
```

Effectively's backtracking system provides a powerful, memory-safe way to implement non-linear control flow that's both performant and easy to reason about. The combination with proper resource management, cancellation, and observability makes it suitable for production use in complex, long-running workflows.
