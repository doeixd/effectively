import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  withCircuitBreaker,
  CircuitOpenError,
  type CircuitBreakerOptions
} from '../src/circuit-breaker';
import {
  createContext,
  defineTask,
  getContext,
  run,
  BacktrackSignal,
  type BaseContext,
  type Task,
  type Logger
} from '../src/run';

interface TestContext extends BaseContext {
  logger: Logger;
  counter: number;
}

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
};

const testContextDefaults: Omit<TestContext, 'scope'> = {
  logger: mockLogger,
  counter: 0
};

describe('Circuit Breaker (circuit-breaker.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('CircuitOpenError', () => {
    it('should create proper error with circuit ID', () => {
      const error = new CircuitOpenError('test-circuit');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(CircuitOpenError);
      expect(error.name).toBe('CircuitOpenError');
      expect(error.id).toBe('test-circuit');
      expect(error.message).toBe('Circuit Breaker "test-circuit" is open and not accepting requests.');
    });

    it('should have proper prototype chain', () => {
      const error = new CircuitOpenError('test');
      expect(Object.getPrototypeOf(error)).toBe(CircuitOpenError.prototype);
    });
  });

  describe('withCircuitBreaker', () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe('CLOSED state behavior', () => {
      it('should allow requests to pass through when circuit is closed', async () => {
        const successTask = defineTask(async (input: string) => `success-${input}`);
        const protectedTask = withCircuitBreaker(successTask, {
          id: 'test-circuit',
          failureThreshold: 3
        });

        const result = await run(protectedTask, 'test');
        expect(result).toBe('success-test');
      });

      it('should record failures but allow requests until threshold is reached', async () => {
        let attempts = 0;
        const flakyTask = defineTask(async (input: string) => {
          attempts++;
          if (attempts <= 2) {
            throw new Error(`Failure ${attempts}`);
          }
          return `success-${input}`;
        });

        const protectedTask = withCircuitBreaker(flakyTask, {
          id: 'flaky-circuit',
          failureThreshold: 3
        });

        // First two should fail but not trip the circuit
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Failure 1');
        await expect(run(protectedTask, 'test2')).rejects.toThrow('Failure 2');
        
        // Third should succeed
        const result = await run(protectedTask, 'test3');
        expect(result).toBe('success-test3');
        
        expect(mockLogger.warn).toHaveBeenCalledTimes(2);
        expect(mockLogger.warn).toHaveBeenNthCalledWith(1, '[Circuit Breaker: flaky-circuit] Recorded failure #1.', { error: expect.any(Error) });
        expect(mockLogger.warn).toHaveBeenNthCalledWith(2, '[Circuit Breaker: flaky-circuit] Recorded failure #2.', { error: expect.any(Error) });
      });

      it('should reset failure count on successful request', async () => {
        let shouldFail = true;
        const conditionalTask = defineTask(async (input: string) => {
          if (shouldFail) {
            shouldFail = false;
            throw new Error('One-time failure');
          }
          return `success-${input}`;
        });

        const protectedTask = withCircuitBreaker(conditionalTask, {
          id: 'reset-circuit',
          failureThreshold: 2
        });

        // First request fails
        await expect(run(protectedTask, 'test1')).rejects.toThrow('One-time failure');
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: reset-circuit] Recorded failure #1.', { error: expect.any(Error) });

        // Second request succeeds and resets the count
        shouldFail = true; // Reset for next failure
        const result = await run(protectedTask, 'test2');
        expect(result).toBe('success-test2');

        // Third request fails again but starts from failure count 1
        await expect(run(protectedTask, 'test3')).rejects.toThrow('One-time failure');
        expect(mockLogger.warn).toHaveBeenLastCalledWith('[Circuit Breaker: reset-circuit] Recorded failure #1.', { error: expect.any(Error) });
      });
    });

    describe('OPEN state behavior', () => {
      it('should trip to OPEN state after reaching failure threshold', async () => {
        const alwaysFailingTask = defineTask(async () => {
          throw new Error('Always fails');
        });

        const protectedTask = withCircuitBreaker(alwaysFailingTask, {
          id: 'failing-circuit',
          failureThreshold: 2
        });

        // First failure
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Always fails');
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: failing-circuit] Recorded failure #1.', { error: expect.any(Error) });

        // Second failure - should trip the circuit
        await expect(run(protectedTask, 'test2')).rejects.toThrow('Always fails');
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: failing-circuit] Recorded failure #2.', { error: expect.any(Error) });
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: failing-circuit] Failure threshold reached. State changed to OPEN.');

        // Third request should fail fast with CircuitOpenError
        await expect(run(protectedTask, 'test3')).rejects.toThrow('is open and not accepting requests');
        expect(mockLogger.warn).toHaveBeenCalledTimes(2); // No additional failure logged
      });

      it('should fail fast with CircuitOpenError when circuit is open', async () => {
        const slowTask = defineTask(async () => {
          await new Promise(resolve => setTimeout(resolve, 1000));
          throw new Error('Should not reach here');
        });

        const protectedTask = withCircuitBreaker(slowTask, {
          id: 'open-circuit',
          failureThreshold: 1
        });

        // Trip the circuit
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Should not reach here');
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: open-circuit] Failure threshold reached. State changed to OPEN.');

        // Subsequent requests should fail fast
        const start = Date.now();
        await expect(run(protectedTask, 'test2')).rejects.toThrow(CircuitOpenError);
        const elapsed = Date.now() - start;
        
        expect(elapsed).toBeLessThan(100); // Should fail immediately
      });
    });

    describe('HALF-OPEN state behavior', () => {
      it('should transition to HALF-OPEN after timeout and succeed on trial request', async () => {
        let shouldFail = true;
        const recoveringTask = defineTask(async (input: string) => {
          if (shouldFail) {
            throw new Error('Still failing');
          }
          return `recovered-${input}`;
        });

        const protectedTask = withCircuitBreaker(recoveringTask, {
          id: 'recovering-circuit',
          failureThreshold: 1,
          openStateTimeoutMs: 1000
        });

        // Trip the circuit
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Still failing');
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: recovering-circuit] Failure threshold reached. State changed to OPEN.');

        // Should be open immediately
        await expect(run(protectedTask, 'test2')).rejects.toThrow('is open and not accepting requests');

        // Advance time to trigger half-open transition
        vi.advanceTimersByTime(1000);
        shouldFail = false; // Allow recovery

        // Next request should transition to HALF-OPEN and succeed
        const result = await run(protectedTask, 'test3');
        expect(result).toBe('recovered-test3');
        
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: recovering-circuit] State changed to HALF-OPEN. Attempting trial request.');
        expect(mockLogger.info).toHaveBeenCalledWith('[Circuit Breaker: recovering-circuit] Trial request succeeded. State changed to CLOSED.');
      });

      it('should return to OPEN state if trial request fails', async () => {
        const alwaysFailingTask = defineTask(async () => {
          throw new Error('Still failing');
        });

        const protectedTask = withCircuitBreaker(alwaysFailingTask, {
          id: 'still-failing-circuit',
          failureThreshold: 1,
          openStateTimeoutMs: 500
        });

        // Trip the circuit
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Still failing');
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: still-failing-circuit] Failure threshold reached. State changed to OPEN.');

        // Advance time to trigger half-open transition
        vi.advanceTimersByTime(500);

        // Trial request should fail and return to OPEN
        await expect(run(protectedTask, 'test2')).rejects.toThrow('is open and not accepting requests');
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: still-failing-circuit] State changed to HALF-OPEN. Attempting trial request.');
        expect(mockLogger.error).toHaveBeenLastCalledWith('[Circuit Breaker: still-failing-circuit] Trial request failed. State changed back to OPEN.');

        // Subsequent requests should fail fast again
        await expect(run(protectedTask, 'test3')).rejects.toThrow(CircuitOpenError);
      });

      it('should only transition to HALF-OPEN after the full timeout period', async () => {
        const failingTask = defineTask(async () => {
          throw new Error('Fails');
        });

        const protectedTask = withCircuitBreaker(failingTask, {
          id: 'timeout-circuit',
          failureThreshold: 1,
          openStateTimeoutMs: 2000
        });

        // Trip the circuit
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Fails');

        // Should still be open before timeout
        vi.advanceTimersByTime(1500);
        await expect(run(protectedTask, 'test2')).rejects.toThrow('is open and not accepting requests');

        // Should transition after timeout
        vi.advanceTimersByTime(500);
        await expect(run(protectedTask, 'test3')).rejects.toThrow('Fails');
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: timeout-circuit] State changed to HALF-OPEN. Attempting trial request.');
      });
    });

    describe('Configuration options', () => {
      it('should respect custom failure threshold', async () => {
        const failingTask = defineTask(async () => {
          throw new Error('Fails');
        });

        const protectedTask = withCircuitBreaker(failingTask, {
          id: 'custom-threshold-circuit',
          failureThreshold: 5
        });

        // Should allow 4 failures without tripping
        for (let i = 1; i <= 4; i++) {
          await expect(run(protectedTask, `test${i}`)).rejects.toThrow('Fails');
          expect(mockLogger.warn).toHaveBeenLastCalledWith(`[Circuit Breaker: custom-threshold-circuit] Recorded failure #${i}.`, { error: expect.any(Error) });
        }

        // 5th failure should trip the circuit
        await expect(run(protectedTask, 'test5')).rejects.toThrow('Fails');
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: custom-threshold-circuit] Failure threshold reached. State changed to OPEN.');
      });

      it('should respect custom open state timeout', async () => {
        const failingTask = defineTask(async () => {
          throw new Error('Fails');
        });

        const protectedTask = withCircuitBreaker(failingTask, {
          id: 'custom-timeout-circuit',
          failureThreshold: 1,
          openStateTimeoutMs: 5000
        });

        // Trip the circuit
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Fails');

        // Should still be open before custom timeout
        vi.advanceTimersByTime(4000);
        await expect(run(protectedTask, 'test2')).rejects.toThrow('is open and not accepting requests');

        // Should transition after custom timeout
        vi.advanceTimersByTime(1000);
        await expect(run(protectedTask, 'test3')).rejects.toThrow('Fails');
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: custom-timeout-circuit] State changed to HALF-OPEN. Attempting trial request.');
      });

      it('should respect custom isFailure predicate', async () => {
        class TemporaryError extends Error {
          constructor() {
            super('Temporary error');
            this.name = 'TemporaryError';
          }
        }

        class PermanentError extends Error {
          constructor() {
            super('Permanent error');
            this.name = 'PermanentError';
          }
        }

        let errorType: 'temporary' | 'permanent' = 'temporary';
        const selectiveFailingTask = defineTask(async () => {
          if (errorType === 'temporary') {
            throw new TemporaryError();
          } else {
            throw new PermanentError();
          }
        });

        const protectedTask = withCircuitBreaker(selectiveFailingTask, {
          id: 'selective-circuit',
          failureThreshold: 2,
          isFailure: (error) => error instanceof PermanentError
        });

        // Temporary errors should not count as failures
        await expect(run(protectedTask, 'test1')).rejects.toThrow('Temporary error');
        await expect(run(protectedTask, 'test2')).rejects.toThrow('Temporary error');
        expect(mockLogger.warn).not.toHaveBeenCalled();

        // Permanent errors should count as failures
        errorType = 'permanent';
        await expect(run(protectedTask, 'test3')).rejects.toThrow(PermanentError);
        expect(mockLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: selective-circuit] Recorded failure #1.', { error: expect.any(PermanentError) });

        await expect(run(protectedTask, 'test4')).rejects.toThrow(PermanentError);
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: selective-circuit] Failure threshold reached. State changed to OPEN.');
      });

      it('should not count BacktrackSignal as failure by default', async () => {
        let protectedTask: any;
        
        const backtrackingTask = defineTask(async function backtrackingImplementation(attempt: number) {
          if (attempt < 3) {
            throw new BacktrackSignal(protectedTask, attempt + 1);
          }
          throw new Error('Real failure');
        });

        protectedTask = withCircuitBreaker(backtrackingTask, {
          id: 'backtrack-circuit',
          failureThreshold: 1
        });

        // BacktrackSignal should eventually result in real failure after retries
        await expect(run(protectedTask, 1)).rejects.toThrow('Real failure');
        expect(mockLogger.warn).toHaveBeenCalledTimes(1); // Real failure should count

        // Circuit should trip after failure threshold
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: backtrack-circuit] Failure threshold reached. State changed to OPEN.');
      });
    });

    describe('Multiple circuit instances', () => {
      it('should maintain separate state for different circuit IDs', async () => {
        const failingTask = defineTask(async (input: string) => {
          throw new Error(`Failure: ${input}`);
        });

        const circuit1 = withCircuitBreaker(failingTask, {
          id: 'circuit-1',
          failureThreshold: 2
        });

        const circuit2 = withCircuitBreaker(failingTask, {
          id: 'circuit-2',
          failureThreshold: 2
        });

        // Trip circuit-1
        await expect(run(circuit1, 'test1')).rejects.toThrow('Failure: test1');
        await expect(run(circuit1, 'test2')).rejects.toThrow('Failure: test2');
        
        // circuit-1 should be open
        await expect(run(circuit1, 'test3')).rejects.toThrow('is open and not accepting requests');

        // circuit-2 should still be closed and working
        await expect(run(circuit2, 'test1')).rejects.toThrow('Failure: test1');
        expect(mockLogger.warn).toHaveBeenLastCalledWith('[Circuit Breaker: circuit-2] Recorded failure #1.', { error: expect.any(Error) });
      });
    });

    describe('Context integration', () => {
      it('should work without logger in context', async () => {
        const { run: runWithoutLogger, defineTask: defineTaskWithoutLogger } = createContext<BaseContext>({});
        
        const task = defineTaskWithoutLogger(async () => {
          throw new Error('Test error');
        });

        const protectedTask = withCircuitBreaker(task, {
          id: 'no-logger-circuit',
          failureThreshold: 1
        });

        // Should not throw due to missing logger
        await expect(runWithoutLogger(protectedTask, undefined)).rejects.toThrow('Test error');
      });

      it('should use context logger when available', async () => {
        const customLogger = {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn()
        };

        const task = defineTask(async () => {
          throw new Error('Custom logger test');
        });

        const protectedTask = withCircuitBreaker(task, {
          id: 'custom-logger-circuit',
          failureThreshold: 1
        });

        await expect(run(protectedTask, undefined, {
          overrides: { logger: customLogger }
        })).rejects.toThrow('Custom logger test');

        expect(customLogger.warn).toHaveBeenCalledWith('[Circuit Breaker: custom-logger-circuit] Recorded failure #1.', { error: expect.any(Error) });
        expect(customLogger.error).toHaveBeenCalledWith('[Circuit Breaker: custom-logger-circuit] Failure threshold reached. State changed to OPEN.');
      });
    });

    describe('Edge cases and error scenarios', () => {
      it('should handle undefined and null values correctly', async () => {
        const nullTask = defineTask(async (input: null) => {
          if (input === null) {
            return 'handled-null';
          }
          throw new Error('Not null');
        });

        const protectedTask = withCircuitBreaker(nullTask, {
          id: 'null-circuit',
          failureThreshold: 2
        });

        const result = await run(protectedTask, null);
        expect(result).toBe('handled-null');
      });

      it('should handle rapid successive calls correctly', async () => {
        let callCount = 0;
        const countingTask = defineTask(async () => {
          callCount++;
          if (callCount <= 2) {
            throw new Error(`Call ${callCount} failed`);
          }
          return `Success on call ${callCount}`;
        });

        const protectedTask = withCircuitBreaker(countingTask, {
          id: 'rapid-circuit',
          failureThreshold: 2
        });

        // Run multiple calls in parallel
        const promises = [
          run(protectedTask, undefined).catch(e => e),
          run(protectedTask, undefined).catch(e => e),
          run(protectedTask, undefined).catch(e => e),
          run(protectedTask, undefined).catch(e => e)
        ];

        const results = await Promise.all(promises);
        
        // At least some should be CircuitOpenError due to rapid tripping
        const openErrors = results.filter(r => r instanceof CircuitOpenError);
        expect(openErrors.length).toBeGreaterThan(0);
      });

      it('should maintain state across different execution contexts', async () => {
        const sharedFailingTask = defineTask(async () => {
          throw new Error('Shared failure');
        });

        const protectedTask = withCircuitBreaker(sharedFailingTask, {
          id: 'shared-circuit',
          failureThreshold: 1
        });

        // Trip circuit in first context
        await expect(run(protectedTask, undefined)).rejects.toThrow('Shared failure');

        // Should be open in second context with different overrides
        await expect(run(protectedTask, undefined, {
          overrides: { counter: 999 }
        })).rejects.toThrow('is open and not accepting requests');
      });
    });

    describe('Recovery scenarios', () => {
      it('should handle mixed success/failure patterns correctly', async () => {
        const pattern = [false, false, true, false, true, true]; // false = fail, true = succeed
        let index = 0;
        
        const patternTask = defineTask(async (input: string) => {
          const shouldSucceed = pattern[index % pattern.length];
          index++;
          
          if (shouldSucceed) {
            return `success-${input}`;
          } else {
            throw new Error(`pattern-failure-${input}`);
          }
        });

        const protectedTask = withCircuitBreaker(patternTask, {
          id: 'pattern-circuit',
          failureThreshold: 2,
          openStateTimeoutMs: 100
        });

        // First two should fail
        await expect(run(protectedTask, 'test1')).rejects.toThrow('pattern-failure-test1');
        await expect(run(protectedTask, 'test2')).rejects.toThrow('pattern-failure-test2');
        expect(mockLogger.error).toHaveBeenCalledWith('[Circuit Breaker: pattern-circuit] Failure threshold reached. State changed to OPEN.');

        // Should be open
        await expect(run(protectedTask, 'test3')).rejects.toThrow('is open and not accepting requests');

        // Wait for half-open transition
        vi.advanceTimersByTime(100);

        // Next should succeed (pattern[2] = true)
        const result = await run(protectedTask, 'test4');
        expect(result).toBe('success-test4');
        expect(mockLogger.info).toHaveBeenCalledWith('[Circuit Breaker: pattern-circuit] Trial request succeeded. State changed to CLOSED.');

        // Continue with pattern
        await expect(run(protectedTask, 'test5')).rejects.toThrow('pattern-failure-test5');
        const result2 = await run(protectedTask, 'test6');
        expect(result2).toBe('success-test6');
      });
    });
  });
});
