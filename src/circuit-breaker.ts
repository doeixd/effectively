/**
 * @module
 * This module provides an advanced Circuit Breaker utility for building
 * resilient, production-grade systems that can intelligently handle failure.
 */

import {
  type Task,
  type Scope,
  type Logger,
  noopLogger,
  isBacktrackSignal,
  // Removed: defineTask, getContext from here, as the enhancer will directly be a Task
} from "./run";

// --- Circuit Breaker ---

/**
 * Defines the distinct states of a Circuit Breaker.
 */
type CircuitStatus = "CLOSED" | "OPEN" | "HALF-OPEN";

/**
 * Encapsulates the state of a single circuit.
 */
interface CircuitState {
  status: CircuitStatus;
  failures: number;
  lastFailureTimestamp: number;
  /**
   * Flag to ensure only one trial request is attempted when in HALF-OPEN state.
   */
  isTrialRequestInProgress: boolean;
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
    this.name = "CircuitOpenError";
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
 * calls to the returned task *that originated from the same `withCircuitBreaker` call*
 * due to closure. Different calls to `withCircuitBreaker` (even with the same ID)
 * will create distinct circuit breaker instances with their own state.
 *
 * @template C The context type, which must include `scope` and can optionally include a `Logger`.
 * @template V The input type of the task.
 * @template R The result type of the task.
 * @param originalTask The fallible `Task` to protect with the circuit breaker.
 * @param options Configuration for the circuit breaker's behavior. An `id` is
 *                required to uniquely identify the conceptual circuit for logging/errors.
 * @returns A new, resilient `Task` that incorporates the circuit breaker logic.
 */
export function withCircuitBreaker<
  C extends { scope: Scope; logger?: Logger },
  V,
  R,
>(
  originalTask: Task<C, V, R>,
  options: CircuitBreakerOptions & { id: string },
): Task<C, V, R> {
  const {
    id,
    failureThreshold = 5,
    openStateTimeoutMs = 30_000,
    isFailure = (err) => !isBacktrackSignal(err),
  } = options;

  // This state object is unique to each call to withCircuitBreaker, forming a closure.
  // This means each enhanced task instance has its own private state.
  const state: CircuitState = {
    status: "CLOSED",
    failures: 0,
    lastFailureTimestamp: 0,
    isTrialRequestInProgress: false,
  };

  const circuitBreakerEnhancedTask: Task<C, V, R> = async (
    context: C,
    value: V,
  ): Promise<R> => {
    const logger = context.logger || noopLogger;

    // --- State Machine Logic ---

    if (state.status === "OPEN") {
      const timeSinceFailure = Date.now() - state.lastFailureTimestamp;
      if (timeSinceFailure > openStateTimeoutMs) {
        // The timeout has passed. The circuit is now ready for a trial.
        // We change the state here to allow ONE request to attempt a trial.
        state.status = "HALF-OPEN";
        state.isTrialRequestInProgress = false; // Reset flag to allow a trial
        logger.warn(
          `[Circuit Breaker: ${id}] State changed to HALF-OPEN. Ready for a trial request.`,
        );
      } else {
        // Still within the timeout period, fail fast.
        throw new CircuitOpenError(id);
      }
    }

    if (state.status === "HALF-OPEN") {
      // If a trial is already in progress, reject subsequent concurrent requests.
      if (state.isTrialRequestInProgress) {
        throw new CircuitOpenError(id);
      }
      // This is the first request to arrive while in HALF-OPEN. Mark it as the trial.
      state.isTrialRequestInProgress = true;
      logger.debug(`[Circuit Breaker: ${id}] Attempting trial request.`);
    }

    // --- Attempt the Operation (status is CLOSED or a trial in HALF-OPEN) ---
    try {
      const result = await originalTask(context, value);

      // --- Success Handling ---
      if (state.status === "HALF-OPEN") {
        logger.info(
          `[Circuit Breaker: ${id}] Trial request succeeded. State changed to CLOSED.`,
        );
      }
      // On any success, the circuit becomes healthy.
      state.status = "CLOSED";
      state.failures = 0;
      state.isTrialRequestInProgress = false; // Ensure trial flag is reset on success.

      return result;
    } catch (error) {
      // --- Failure Handling ---

      // If this was a non-counted error (like a backtrack signal), it should not affect the circuit state.
      // However, if it was a trial request, we must reset the flag to allow another trial.
      if (!isFailure(error)) {
        if (state.status === "HALF-OPEN") {
          state.isTrialRequestInProgress = false; // Reset for another attempt
        }
        throw error;
      }

      // It's a counted failure.
      state.failures++;
      state.lastFailureTimestamp = Date.now();
      logger.warn(
        `[Circuit Breaker: ${id}] Recorded failure #${state.failures}. Last failure at ${state.lastFailureTimestamp}`,
        { error },
      );

      if (state.status === "HALF-OPEN") {
        // The trial request failed. Re-open the circuit.
        state.status = "OPEN";
        logger.error(
          `[Circuit Breaker: ${id}] Trial request failed. State changed back to OPEN.`,
        );
      } else if (
        state.status === "CLOSED" &&
        state.failures >= failureThreshold
      ) {
        // The failure threshold has been reached. Trip the circuit.
        state.status = "OPEN";
        logger.error(
          `[Circuit Breaker: ${id}] Failure threshold reached. State changed to OPEN.`,
        );
      }

      // After any counted failure during a trial, the trial is over.
      if (state.isTrialRequestInProgress) {
        state.isTrialRequestInProgress = false;
      }

      throw error;
    }
  };

  Object.defineProperty(circuitBreakerEnhancedTask, "name", {
    value: `circuitBreaker(${originalTask.name || "anonymousTask"})-${id}`,
    configurable: true,
  });

  // Optional: Propagate __task_id if the original task had one.
  // This might be relevant if the circuit breaker itself is part of a
  // sequence where its wrapper (this enhanced task) needs to be identifiable
  // for backtracking, though typically the originalTask is the backtrack target.
  if (originalTask.__task_id) {
    Object.defineProperty(circuitBreakerEnhancedTask, "__task_id", {
      value: originalTask.__task_id, // Or a new Symbol if it should be distinct
      configurable: true,
      enumerable: false,
      writable: false,
    });
  }

  return circuitBreakerEnhancedTask;
}
