// File: debug_cb_context.ts

import {
  createContext,
  type BaseContext,
  type Task,
  type Logger,
  type Scope,
} from '../src/run'; // Adjust path to your run.ts
import {
  withCircuitBreaker,
  CircuitOpenError,
} from '../src/circuit-breaker'; // Adjust path to your circuit-breaker.ts

// --- Mock Logger Setup ---
// Create distinctly identifiable mock functions for logging
const createMockLogger = (name: string): Logger => ({
  debug: (...args: any[]) => console.log(`[DEBUG LOGGER - ${name}] DEBUG:`, ...args),
  info: (...args: any[]) => console.log(`[DEBUG LOGGER - ${name}] INFO:`, ...args),
  warn: (...args: any[]) => console.log(`[DEBUG LOGGER - ${name}] WARN:`, ...args),
  error: (...args: any[]) => console.log(`[DEBUG LOGGER - ${name}] ERROR:`, ...args),
});

const defaultTestLogger = createMockLogger('DEFAULT_IN_CONTEXT');
const overrideTestLogger = createMockLogger('OVERRIDE_IN_RUN_OPTIONS');

// --- Context Definition ---
interface DebugContext extends BaseContext {
  logger: Logger;
  someOtherProp: string;
}

// --- Script Execution ---
async function main() {
  console.log('--- Starting Debug Script ---');

  // 1. Create ContextTools with a default logger
  const { run, defineTask } = createContext<DebugContext>({
    // `scope` will be added by `run` automatically
    logger: defaultTestLogger,
    someOtherProp: 'default_value',
  });
  console.log('[DEBUG SCRIPT] ContextTools created.');

  // 2. Define a simple task that will be protected by the circuit breaker
  const originalFailingTask = defineTask(async (input: string) => {
    console.log(`[DEBUG SCRIPT - originalFailingTask] Task called with input: ${input}. Attempting to use logger from context.`);
    // This task is defined using `defineTask` from our `createContext` instance.
    // So, `getContext()` inside it (if it were used) would refer to DebugContext.
    // However, withCircuitBreaker passes the context directly.
    throw new Error(`Task failure for input: ${input}`);
  });
  console.log('[DEBUG SCRIPT] originalFailingTask defined.');

  // 3. Wrap the task with the circuit breaker
  const circuitId = 'debug-cb-instance';
  const protectedTask = withCircuitBreaker(originalFailingTask, {
    id: circuitId,
    failureThreshold: 1, // Trip on first failure for easier debugging
    openStateTimeoutMs: 10000,
  });
  console.log(`[DEBUG SCRIPT] protectedTask created for circuit ID: ${circuitId}`);

  // 4. Run the protected task with logger override
  console.log('[DEBUG SCRIPT] Attempting to run protectedTask with logger override...');
  try {
    await run(
      protectedTask, // The task enhanced by withCircuitBreaker
      'debug_input_value', // Initial value for the task
      {
        // RunOptions
        overrides: {
          logger: overrideTestLogger, // This is the critical override
          someOtherProp: 'overridden_value',
        },
        // No parentSignal or throw:false needed for this debug
      }
    );
  } catch (error: any) {
    console.log('[DEBUG SCRIPT] Caught error from run:', error.name, error.message);
    if (error instanceof CircuitOpenError) {
      console.log(`[DEBUG SCRIPT] Caught CircuitOpenError for ID: ${error.id}`);
    }
  }

  console.log('\n--- Verifying Logger Calls ---');
  // Manually "check" which logger was called.
  // In a real test, you'd use vi.fn().toHaveBeenCalledWith(...)
  // Here, we rely on the console output from the mock loggers.
  // If overrideTestLogger.warn was called, you'll see its specific prefix.

  console.log('--- End of Debug Script ---');
}

// Add this to your circuit-breaker.ts temporarily for this debug session:
// Inside circuitBreakerEnhancedTask, at the very beginning:
/*
  const circuitBreakerEnhancedTask: Task<C, V, R> = async (context: C, value: V): Promise<R> => {
    const receivedLoggerName = context.logger === defaultTestLogger ? 'DEFAULT_IN_CONTEXT'
                             : context.logger === overrideTestLogger ? 'OVERRIDE_IN_RUN_OPTIONS'
                             : context.logger === noopLogger ? 'NOOP_LOGGER'
                             : 'UNKNOWN_LOGGER_INSTANCE';
    console.log(`[CB DEBUG - ${id}] circuitBreakerEnhancedTask called. Received context.logger identified as: ${receivedLoggerName}`);
    console.log(`[CB DEBUG - ${id}] Received context.someOtherProp:`, (context as any).someOtherProp); // Cast if someOtherProp not on C

    const logger = context.logger || noopLogger;
    // ... rest of the function
*/


main().catch(console.error);