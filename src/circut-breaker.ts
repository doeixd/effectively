
/**
 * @module
 * This module provides an advanced Circuit Breaker utility for building
 * resilient, production-grade systems that can intelligently handle failure.
 */

import { type Task, type Scope, type Logger, noopLogger, defineTask, getContext, isBacktrackSignal } from './run';

// --- Circuit Breaker ---

/**
 * Defines the distinct states of a Circuit Breaker.
 */
type CircuitStatus = 'CLOSED' | 'OPEN' | 'HALF-OPEN';

/**
 * Encapsulates the state of a single circuit.
 */
interface CircuitState {
  status: CircuitStatus;
  failures: number;
  lastFailureTimestamp: number;
}

/**
 * Configuration options for the Circuit Breaker.
 */
export interface CircuitBreakerOptions {
  /**
   * The number of consecutive failures required to trip the circuit and move it to the 'OPEN' state.
   * @default 5
   */
  failureThreshold?: number;
  /**
   * The duration in milliseconds that the circuit will remain 'OPEN' before transitioning to 'HALF-OPEN' to attempt a recovery.
   * @default 30000 (30 seconds)
   */
  openStateTimeoutMs?: number;
  /**
   * A function to determine if a specific error should be counted as a failure.
   * By default, all thrown errors (except for `BacktrackSignal`) are considered failures.
   * @param error The error thrown by the task.
   * @returns `true` if the error should count as a failure, `false` otherwise.
   */
  isFailure?: (error: unknown) => boolean;
}

/**
 * A custom error thrown by the circuit breaker when it is in the 'OPEN' state.
 * This allows consumers to specifically handle this case and, for example,
 * provide a cached response or a graceful fallback UI.
 */
export class CircuitOpenError extends Error {
  constructor(public readonly id: string) {
    super(`Circuit Breaker "${id}" is open and not accepting requests.`);
    this.name = 'CircuitOpenError';
    Object.setPrototypeOf(this, CircuitOpenError.prototype);
  }
}

/**
 * A higher-order task that wraps another task with the Circuit Breaker pattern.
 *
 * This utility provides intelligent, adaptive resilience by monitoring a task
 * for failures. When a failure threshold is reached, it "trips" the circuit,
 * causing subsequent calls to fail fast without executing the underlying task.
 * After a configured timeout, it enters a "half-open" state to cautiously
 * retry the operation, automatically recovering if the task succeeds.
 *
 * The state of the circuit is managed in memory and is shared across all
 * calls to the returned task within the same process.
 *
 * @template C The context type, which can optionally include a `Logger`.
 * @template V The input type of the task.
 * @template R The result type of the task.
 * @param task The fallible `Task` to protect with the circuit breaker.
 * @param options Configuration for the circuit breaker's behavior. An `id` is
 *                required to uniquely identify the circuit's state.
 * @returns A new, resilient `Task` that incorporates the circuit breaker logic.
 *
 * @example
 * ```typescript
 * const unstableFetch = defineTask(async (url: string) => {
 *   // This might throw a NetworkError
 *   return fetch(url);
 * });
 *
 * // Protect the task with a circuit breaker.
 * const resilientFetch = withCircuitBreaker(unstableFetch, {
 *   id: 'external-api',
 *   failureThreshold: 3,
 *   openStateTimeoutMs: 60000, // 1 minute
 * });
 *
 * // Use the resilient task in a workflow.
 * try {
 *   const response = await run(resilientFetch, 'https://api.example.com/data');
 * } catch (error) {
 *   if (error instanceof CircuitOpenError) {
 *     // The circuit is open, provide a fallback.
 *     console.log('Service is temporarily unavailable, serving from cache.');
 *   } else {
 *     // Handle other types of errors.
 *     console.error('An unexpected error occurred:', error);
 *   }
 * }
 * ```
 */
export function withCircuitBreaker<C extends { scope: Scope; logger?: Logger }, V, R>(
  task: Task<C, V, R>,
  options: CircuitBreakerOptions & { id: string }
): Task<C, V, R> {
  const {
    id,
    failureThreshold = 5,
    openStateTimeoutMs = 30000,
    isFailure = (err) => !isBacktrackSignal(err),
  } = options;

  // The state is encapsulated within the closure of this function,
  // making it self-contained and reusable without context setup.
  const state: CircuitState = {
    status: 'CLOSED',
    failures: 0,
    lastFailureTimestamp: 0,
  };

  return defineTask(async (value: V) => {
    const context = getContext<C>();
    const logger = context.logger || noopLogger;

    // --- State Machine Logic ---

    // 1. Check if an OPEN breaker is ready to move to HALF-OPEN.
    if (state.status === 'OPEN') {
      const timeSinceFailure = Date.now() - state.lastFailureTimestamp;
      if (timeSinceFailure > openStateTimeoutMs) {
        state.status = 'HALF-OPEN';
        logger.warn(`[Circuit Breaker: ${id}] State changed to HALF-OPEN. Attempting trial request.`);
      }
    }

    // 2. If the circuit is OPEN, reject the request immediately (fail fast).
    if (state.status === 'OPEN') {
      throw new CircuitOpenError(id);
    }

    // --- Attempt the Operation (status is CLOSED or HALF-OPEN) ---
    try {
      const result = await task(context, value);

      // --- Success Handling ---
      // If the operation succeeds, it's a good sign. Reset the circuit.
      if (state.status === 'HALF-OPEN') {
        logger.info(`[Circuit Breaker: ${id}] Trial request succeeded. State changed to CLOSED.`);
      }
      state.status = 'CLOSED';
      state.failures = 0;

      return result;
    } catch (error) {
      // --- Failure Handling ---

      // Only act if the error is considered a failure.
      if (!isFailure(error)) {
        throw error; // Not a failure, so just re-throw.
      }

      state.failures++;
      state.lastFailureTimestamp = Date.now();
      logger.warn(`[Circuit Breaker: ${id}] Recorded failure #${state.failures}.`, { error });

      if (state.status === 'HALF-OPEN') {
        // The trial request failed. The service is still down. Re-open the circuit.
        state.status = 'OPEN';
        logger.error(`[Circuit Breaker: ${id}] Trial request failed. State changed back to OPEN.`);
      } else if (state.failures >= failureThreshold) {
        // The failure threshold has been reached. Trip the circuit.
        state.status = 'OPEN';
        logger.error(`[Circuit Breaker: ${id}] Failure threshold reached. State changed to OPEN.`);
      }

      // Re-throw the original error so it can be handled upstream.
      throw error;
    }
  });
}