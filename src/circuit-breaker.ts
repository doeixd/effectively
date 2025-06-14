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
    openStateTimeoutMs = 30000,
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

  // This function itself becomes the new Task, directly receiving context.
  const circuitBreakerEnhancedTask: Task<C, V, R> = async (
    context: C,
    value: V,
  ): Promise<R> => {
    // console.log(`[CB INTERNAL DEBUG - ${id}] Task context received. logger.warn function reference:`, context.logger?.warn?.toString().slice(0, 100)); // Log part of function string
    // console.log(`[CB INTERNAL DEBUG - ${id}] Task context.someOtherProp:`, (context as any).someOtherProp);
    // The `context` here is the one prepared by the `run` engine, including any overrides.
    const logger = context.logger || noopLogger;

    // --- State Machine Logic ---

    // 1. Check if an OPEN breaker is ready to move to HALF-OPEN.
    if (state.status === "OPEN") {
      const timeSinceFailure = Date.now() - state.lastFailureTimestamp;
      if (
        timeSinceFailure > openStateTimeoutMs &&
        !state.isTrialRequestInProgress
      ) {
        state.status = "HALF-OPEN";
        state.isTrialRequestInProgress = true;
        logger.warn(
          `[Circuit Breaker: ${id}] State changed to HALF-OPEN. Attempting trial request.`,
        );
      }
    }

    // 2. If the circuit is OPEN (and not the one actively attempting a trial), reject immediately.
    if (state.status === "OPEN") {
      throw new CircuitOpenError(id);
    }

    // --- Attempt the Operation (status is CLOSED or HALF-OPEN) ---
    try {
      const result = await originalTask(context, value); // Pass the received context directly

      // --- Success Handling ---
      if (state.status === "HALF-OPEN") {
        logger.info(
          `[Circuit Breaker: ${id}] Trial request succeeded. State changed to CLOSED.`,
        );
        state.isTrialRequestInProgress = false;
      }
      // Reset the circuit to CLOSED on any success.
      state.status = "CLOSED";
      state.failures = 0;
      // lastFailureTimestamp is not reset here; it's relevant for OPEN -> HALF-OPEN timing.

      return result;
    } catch (error) {
      // --- Failure Handling ---

      // If it was a trial request that failed due to a non-counted error,
      // reset the trial flag as this attempt is over. The status remains HALF-OPEN.
      if (
        state.status === "HALF-OPEN" &&
        state.isTrialRequestInProgress &&
        !isFailure(error)
      ) {
        state.isTrialRequestInProgress = false;
        // Potentially log that a trial attempt concluded without counting as a CB failure.
        // logger.debug(`[Circuit Breaker: ${id}] Trial request encountered a non-counted error. Remaining HALF-OPEN.`);
      }

      // Only act further if the error is considered a primary failure by the predicate.
      if (!isFailure(error)) {
        throw error; // Not a counted failure, so just re-throw.
      }

      // It's a counted failure
      state.failures++;
      state.lastFailureTimestamp = Date.now();
      logger.warn(
        `[Circuit Breaker: ${id}] Recorded failure #${state.failures}. Last failure at ${state.lastFailureTimestamp}`,
        { error },
      );

      if (state.status === "HALF-OPEN") {
        // The trial request (which was in progress) failed with a counted error.
        state.status = "OPEN";
        state.isTrialRequestInProgress = false; // Reset trial flag on counted failure during trial
        logger.error(
          `[Circuit Breaker: ${id}] Trial request failed. State changed back to OPEN.`,
        );
      } else if (
        state.status === "CLOSED" &&
        state.failures >= failureThreshold
      ) {
        // Failure threshold reached while in CLOSED state. Trip the circuit.
        state.status = "OPEN";
        // isTrialRequestInProgress is false by default when moving from CLOSED
        logger.error(
          `[Circuit Breaker: ${id}] Failure threshold reached. State changed to OPEN.`,
        );
      }

      throw error; // Re-throw the original counted error.
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
