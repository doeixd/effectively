import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  withCircuitBreaker,
  CircuitOpenError,
} from '../src/circuit-breaker'; // Assuming path to your compiled JS or TS source
import {
  createContext,
  BacktrackSignal,
  type BaseContext,
  type Task,
  type Logger,
} from '../src/run';

interface TestContext extends BaseContext {
  logger: Logger;
  counter: number;
}

const globalMockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Create context tools once, tests can override logger via run options
const { run, defineTask: defineTaskScoped } = createContext<TestContext>({
  logger: globalMockLogger,
  counter: 0,
});

let testCircuitIdCounter = 0;
const getUniqueCircuitId = (prefix = 'test-circuit-') => `${prefix}${testCircuitIdCounter++}`;

describe('Circuit Breaker (circuit-breaker.ts)', () => {
  beforeEach(() => {
    globalMockLogger.debug.mockClear();
    globalMockLogger.info.mockClear();
    globalMockLogger.warn.mockClear();
    globalMockLogger.error.mockClear();
    vi.useFakeTimers();
    testCircuitIdCounter = 0;
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
      expect(error.message).toBe(
        'Circuit Breaker "test-circuit" is open and not accepting requests.'
      );
    });

    it('should have proper prototype chain', () => {
      const error = new CircuitOpenError('test');
      expect(Object.getPrototypeOf(error)).toBe(CircuitOpenError.prototype);
    });
  });

  describe('withCircuitBreaker', () => {
    describe('CLOSED state behavior', () => {
      it('should allow requests to pass through when circuit is closed', async () => {
        const circuitId = getUniqueCircuitId('closed-allow');
        const successTask = defineTaskScoped(async (input: string) => `success-${input}`);
        const protectedTask = withCircuitBreaker(successTask, { // No tools argument
          id: circuitId,
          failureThreshold: 3,
        });

        const result = await run(protectedTask, 'test');
        expect(result).toBe('success-test');
        expect(globalMockLogger.warn).not.toHaveBeenCalled();
      });

      it('should record failures but allow requests until threshold is reached', async () => {
        const circuitId = getUniqueCircuitId('closed-record-failures');
        let attempts = 0;
        const flakyTask = defineTaskScoped(async (input: string) => {
          attempts++;
          if (attempts <= 2) {
            throw new Error(`Failure ${attempts}`);
          }
          return `success-${input}`;
        });

        const protectedTask = withCircuitBreaker(flakyTask, { // No tools argument
          id: circuitId,
          failureThreshold: 3,
        });

        await expect(run(protectedTask, 'test1')).rejects.toThrow('Failure 1');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`),
          { error: expect.objectContaining({ message: 'Failure 1' }) }
        );

        await expect(run(protectedTask, 'test2')).rejects.toThrow('Failure 2');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #2.`),
          { error: expect.objectContaining({ message: 'Failure 2' }) }
        );

        const result = await run(protectedTask, 'test3');
        expect(result).toBe('success-test3');
        expect(globalMockLogger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('Failure threshold reached')
        );
      });

      it('should reset failure count on successful request', async () => {
        const circuitId = getUniqueCircuitId('closed-reset-on-success');
        let failureOccurred = false;
        const conditionalTask = defineTaskScoped(async (input: string) => {
          if (!failureOccurred) {
            failureOccurred = true;
            throw new Error('One-time failure');
          }
          return `success-${input}`;
        });

        const protectedTask = withCircuitBreaker(conditionalTask, { // No tools argument
          id: circuitId,
          failureThreshold: 2,
        });

        await expect(run(protectedTask, 'test1')).rejects.toThrow('One-time failure');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`),
          { error: expect.any(Error) }
        );
        globalMockLogger.warn.mockClear();

        failureOccurred = true;
        const result = await run(protectedTask, 'test2');
        expect(result).toBe('success-test2');
        expect(globalMockLogger.warn).not.toHaveBeenCalled();

        failureOccurred = false;
        await expect(run(protectedTask, 'test3')).rejects.toThrow('One-time failure');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`),
          { error: expect.any(Error) }
        );
      });
    });

    describe('OPEN state behavior', () => {
      it('should trip to OPEN state after reaching failure threshold', async () => {
        const circuitId = getUniqueCircuitId('open-trip-circuit');
        const alwaysFailingTask = defineTaskScoped(async () => {
          throw new Error('Always fails');
        });
        const protectedTask = withCircuitBreaker(alwaysFailingTask, { // No tools argument
          id: circuitId,
          failureThreshold: 2,
        });

        await expect(run(protectedTask, 'test1')).rejects.toThrow('Always fails');
        await expect(run(protectedTask, 'test2')).rejects.toThrow('Always fails');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );

        await expect(run(protectedTask, 'test3')).rejects.toThrow(new CircuitOpenError(circuitId));
      });

      it('should fail fast with CircuitOpenError when circuit is open', async () => {
        const circuitId = getUniqueCircuitId('open-fail-fast-circuit');
        const slowTask = defineTaskScoped(async () => {
          vi.advanceTimersByTime(100);
          throw new Error('Underlying task error');
        });
        const protectedTask = withCircuitBreaker(slowTask, { // No tools argument
          id: circuitId,
          failureThreshold: 1,
        });

        await expect(run(protectedTask, 'test1')).rejects.toThrow('Underlying task error');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );

        const startTime = Date.now();
        await expect(run(protectedTask, 'test2')).rejects.toThrow(new CircuitOpenError(circuitId));
        const endTime = Date.now();
        expect(endTime - startTime).toBeLessThan(50);
      });
    });

    describe('HALF-OPEN state behavior', () => {
      it('should transition to HALF-OPEN after timeout and succeed on trial request', async () => {
        const circuitId = getUniqueCircuitId('half-open-success-circuit');
        let allowRecovery = false;
        const recoveringTask = defineTaskScoped(async (input: string) => {
          if (!allowRecovery) {
            throw new Error('Still failing');
          }
          return `recovered-${input}`;
        });
        const protectedTask = withCircuitBreaker(recoveringTask, { // No tools argument
          id: circuitId,
          failureThreshold: 1,
          openStateTimeoutMs: 1000,
        });

        await expect(run(protectedTask, 'test1')).rejects.toThrow('Still failing');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );
        await expect(run(protectedTask, 'test2')).rejects.toThrow(new CircuitOpenError(circuitId));

        vi.advanceTimersByTime(1001);
        allowRecovery = true;

        const result = await run(protectedTask, 'test3'); // Trial
        expect(result).toBe('recovered-test3');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] State changed to HALF-OPEN. Attempting trial request.`)
        );
        expect(globalMockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Trial request succeeded. State changed to CLOSED.`)
        );

        allowRecovery = true;
        const result2 = await run(protectedTask, 'test4');
        expect(result2).toBe('recovered-test4');
      });

      it('should return to OPEN state if trial request fails', async () => {
        const circuitId = getUniqueCircuitId('half-open-fail-circuit');
        const alwaysFailingTask = defineTaskScoped(async () => {
          throw new Error('Trial always fails');
        });
        const protectedTask = withCircuitBreaker(alwaysFailingTask, { // No tools argument
          id: circuitId,
          failureThreshold: 1,
          openStateTimeoutMs: 500,
        });

        await expect(run(protectedTask, 'test1')).rejects.toThrow('Trial always fails');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );

        vi.advanceTimersByTime(501);

        await expect(run(protectedTask, 'test2')).rejects.toThrow('Trial always fails');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] State changed to HALF-OPEN. Attempting trial request.`)
        );
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Trial request failed. State changed back to OPEN.`)
        );

        await expect(run(protectedTask, 'test3')).rejects.toThrow(new CircuitOpenError(circuitId));
      });

      it('should only transition to HALF-OPEN after the full timeout period', async () => {
        const circuitId = getUniqueCircuitId('half-open-full-timeout-circuit');
        const failingTask = defineTaskScoped(async () => { throw new Error('Fails'); });
        const protectedTask = withCircuitBreaker(failingTask, { // No tools argument
          id: circuitId,
          failureThreshold: 1,
          openStateTimeoutMs: 2000,
        });

        await expect(run(protectedTask, 'trip')).rejects.toThrow('Fails');

        vi.advanceTimersByTime(1999);
        await expect(run(protectedTask, 'still-open')).rejects.toThrow(new CircuitOpenError(circuitId));
        expect(globalMockLogger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining('State changed to HALF-OPEN')
        );

        vi.advanceTimersByTime(2);
        await expect(run(protectedTask, 'trial')).rejects.toThrow('Fails');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] State changed to HALF-OPEN. Attempting trial request.`)
        );
      });
    });

    describe('Configuration options', () => {
      it('should respect custom failure threshold', async () => {
        const circuitId = getUniqueCircuitId('config-threshold-circuit');
        const failingTask = defineTaskScoped(async () => { throw new Error('Fails'); });
        const protectedTask = withCircuitBreaker(failingTask, { // No tools argument
          id: circuitId,
          failureThreshold: 5,
        });

        for (let i = 1; i <= 4; i++) {
          await expect(run(protectedTask, `test${i}`)).rejects.toThrow('Fails');
          expect(globalMockLogger.warn).toHaveBeenCalledWith(
            expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #${i}.`), { error: expect.any(Error) }
          );
        }
        expect(globalMockLogger.error).not.toHaveBeenCalledWith(
          expect.stringContaining('Failure threshold reached')
        );

        await expect(run(protectedTask, 'test5')).rejects.toThrow('Fails');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );
      });

      it('should respect custom open state timeout', async () => {
        const circuitId = getUniqueCircuitId('config-custom-timeout-circuit');
        const failingTask = defineTaskScoped(async () => { throw new Error('Fails'); });
        const protectedTask = withCircuitBreaker(failingTask, { // No tools argument
          id: circuitId,
          failureThreshold: 1,
          openStateTimeoutMs: 5000,
        });

        await expect(run(protectedTask, 'trip')).rejects.toThrow('Fails');

        vi.advanceTimersByTime(4999);
        await expect(run(protectedTask, 'still-open')).rejects.toThrow(new CircuitOpenError(circuitId));

        vi.advanceTimersByTime(2);
        await expect(run(protectedTask, 'trial')).rejects.toThrow('Fails');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] State changed to HALF-OPEN. Attempting trial request.`)
        );
      });

      it('should respect custom isFailure predicate', async () => {
        const circuitId = getUniqueCircuitId('config-isFailure-circuit');
        class TemporaryError extends Error { constructor() { super('Temporary'); this.name = "TemporaryError"; } }
        class PermanentError extends Error { constructor() { super('Permanent'); this.name = "PermanentError"; } }

        let errorToThrow: Error = new TemporaryError();
        const selectiveFailingTask = defineTaskScoped(async () => { throw errorToThrow; });
        const protectedTask = withCircuitBreaker(selectiveFailingTask, { // No tools argument
          id: circuitId,
          failureThreshold: 2,
          isFailure: (error) => error instanceof PermanentError,
        });

        errorToThrow = new TemporaryError();
        await expect(run(protectedTask, 'temp1')).rejects.toThrow(TemporaryError);
        errorToThrow = new TemporaryError();
        await expect(run(protectedTask, 'temp2')).rejects.toThrow(TemporaryError);
        expect(globalMockLogger.warn).not.toHaveBeenCalledWith(
          expect.stringContaining("Recorded failure")
        );

        errorToThrow = new PermanentError();
        await expect(run(protectedTask, 'perm1')).rejects.toThrow(PermanentError);
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`),
          { error: expect.any(PermanentError) }
        );

        errorToThrow = new PermanentError();
        await expect(run(protectedTask, 'perm2')).rejects.toThrow(PermanentError);
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );
      });

      it('should not count BacktrackSignal as failure by default', async () => {
        const circuitId = getUniqueCircuitId('config-backtrack-default-circuit');

        const backtrackingLogic = defineTaskScoped(async function actualBacktrackingTask(attempt: number) {
          if (attempt < 2) {
            throw new BacktrackSignal(backtrackingLogic, attempt + 1);
          }
          throw new Error('Real failure after backtrack');
        });

        const taskInstanceForBacktrack = withCircuitBreaker(backtrackingLogic, { // No tools argument
          id: circuitId,
          failureThreshold: 1,
        });

        await expect(run(taskInstanceForBacktrack, 1)).rejects.toThrow('Real failure after backtrack');
        expect(globalMockLogger.warn).toHaveBeenCalledTimes(1);
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`),
          { error: expect.objectContaining({ message: 'Real failure after backtrack' }) }
        );
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );
      });
    });

    describe('Multiple circuit instances', () => {
      it('should maintain separate state for different circuit IDs', async () => {
        const id1 = 'multi-instance-id-A1'; // Explicitly different IDs
        const id2 = 'multi-instance-id-B2';
        const failingTask = defineTaskScoped(async (idSuffix: string) => { throw new Error(`Fail id-${idSuffix}`); });

        const protected1 = withCircuitBreaker(failingTask, { id: id1, failureThreshold: 1 }); // No tools
        const protected2 = withCircuitBreaker(failingTask, { id: id2, failureThreshold: 1 }); // No tools

        await expect(run(protected1, '1a')).rejects.toThrow('Fail id-1a');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${id1}] Failure threshold reached. State changed to OPEN.`)
        );
        // Clear mocks if asserting calls for different circuits sequentially in the same test
        globalMockLogger.error.mockClear();
        globalMockLogger.warn.mockClear();

        await expect(run(protected1, '1b')).rejects.toThrow(new CircuitOpenError(id1));

        await expect(run(protected2, '2a')).rejects.toThrow('Fail id-2a');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${id2}] Recorded failure #1.`),
          { error: expect.objectContaining({ message: 'Fail id-2a' }) }
        );
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${id2}] Failure threshold reached. State changed to OPEN.`)
        );
      });
    });

    describe('Context integration', () => {
      it('should work without logger in context if context only has scope', async () => {
        const circuitId = getUniqueCircuitId('ctx-no-logger-circuit-B');
        const minimalContextTools = createContext<BaseContext>({});
        const { run: runMinimal, defineTask: defineMinimalTask } = minimalContextTools;

        const task = defineMinimalTask(async () => { throw new Error('Test error no logger'); });

        const protectedTask = withCircuitBreaker(
          task as Task<BaseContext & { logger?: Logger }, void, void>, // Cast needed as C expects logger?
          { id: circuitId, failureThreshold: 1 }
        );

        await expect(runMinimal(protectedTask, undefined)).rejects.toThrow('Test error no logger');
      });

      it('should use context logger when available', async () => {
        const circuitId = getUniqueCircuitId('ctx-custom-logger-circuit-B');
        const customLocalLogger = {
          debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
        };
        const task = defineTaskScoped(async () => { throw new Error('Custom logger error'); });
        const protectedTask = withCircuitBreaker(task, { id: circuitId, failureThreshold: 1 }); // No tools

        await expect(run(protectedTask, undefined, { overrides: { logger: customLocalLogger } }))
          .rejects.toThrow('Custom logger error');

        expect(customLocalLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`), { error: expect.objectContaining({ message: 'Custom logger error' }) }
        );
        expect(customLocalLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );
        // Ensure the global mock logger (default for the context) was NOT called
        // because the override should have taken precedence.
        expect(globalMockLogger.warn).not.toHaveBeenCalled();
        expect(globalMockLogger.error).not.toHaveBeenCalled();
      });
    });

    describe('Edge cases and error scenarios', () => {
      it('should handle undefined and null values correctly as input', async () => {
        const circuitId = getUniqueCircuitId('edge-null-undef-circuit-B');
        const taskAcceptsNull = defineTaskScoped(async (input: null | undefined) => {
          if (input === null) return 'null processed';
          if (input === undefined) return 'undefined processed';
          throw new Error('Unexpected input');
        });
        const protectedTask = withCircuitBreaker(taskAcceptsNull, { id: circuitId }); // No tools

        expect(await run(protectedTask, null)).toBe('null processed');
        expect(await run(protectedTask, undefined)).toBe('undefined processed');
      });

      it('should handle rapid successive calls correctly (trial request)', async () => {
        const circuitId = getUniqueCircuitId('edge-rapid-trial-circuit-B');
        let actualTaskExecutions = 0;
        const slowTrialTask = defineTaskScoped(async () => {
          actualTaskExecutions++;
          await new Promise(r => setTimeout(r, 50));
          return 'trial success rapid';
        });

        let tripDone = false;
        const trippingAndSlowTask = defineTaskScoped(async () => {
          if (!tripDone) {
            tripDone = true;
            throw new Error('Forced trip for rapid test B');
          }
          return slowTrialTask(undefined as any, undefined);
        });

        const protectedTask = withCircuitBreaker(trippingAndSlowTask, { // No tools
          id: circuitId,
          failureThreshold: 1,
          openStateTimeoutMs: 100,
        });

        await expect(run(protectedTask, undefined)).rejects.toThrow('Forced trip for rapid test B');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );

        vi.advanceTimersByTime(101);

        const promises = [
          run(protectedTask, undefined),
          run(protectedTask, undefined).catch(e => e),
          run(protectedTask, undefined).catch(e => e),
        ];

        const results = await Promise.all(promises);

        const successResults = results.filter(r => r === 'trial success rapid');
        const openErrors = results.filter(r => r instanceof CircuitOpenError && r.id === circuitId);

        expect(actualTaskExecutions).toBe(1);
        expect(successResults.length).toBe(1);
        expect(openErrors.length).toBe(2);

        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] State changed to HALF-OPEN. Attempting trial request.`)
        );
        expect(globalMockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Trial request succeeded. State changed to CLOSED.`)
        );
      });

      it('should maintain state across different run calls if ID is the same', async () => {
        const circuitId = 'fixed-id-for-shared-state-test-runs-B';
        const task = defineTaskScoped(async () => { throw new Error('Shared state fail for runs B'); });

        // IMPORTANT: protectedTask is defined ONCE with the fixed ID
        const protectedTask = withCircuitBreaker(task, { id: circuitId, failureThreshold: 1 }); // No tools

        await expect(run(protectedTask, undefined)).rejects.toThrow('Shared state fail for runs B');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );

        // Call run again with the SAME protectedTask instance
        await expect(run(protectedTask, undefined, { overrides: { counter: 123 } }))
          .rejects.toThrow(new CircuitOpenError(circuitId));
      });
    });

    describe('Recovery scenarios', () => {
      it('should handle mixed success/failure patterns correctly', async () => {
        const circuitId = getUniqueCircuitId('recovery-mixed-pattern-circuit-B');
        const responses = [
          () => { throw new Error('FailPattern1B'); },
          () => { throw new Error('FailPattern2B'); },
          () => 'SuccessPatternAfterOpenB',
          () => { throw new Error('FailPattern3B'); },
          () => 'SuccessPatternAgainB',
          () => 'SuccessPatternFinalB',
        ];
        let responseIdx = 0;
        const patternedTask = defineTaskScoped(async () => responses[responseIdx++]());
        const protectedTask = withCircuitBreaker(patternedTask, { // No tools
          id: circuitId,
          failureThreshold: 2,
          openStateTimeoutMs: 100,
        });

        await expect(run(protectedTask, undefined)).rejects.toThrow('FailPattern1B');
        await expect(run(protectedTask, undefined)).rejects.toThrow('FailPattern2B');
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );

        await expect(run(protectedTask, undefined)).rejects.toThrow(new CircuitOpenError(circuitId));

        vi.advanceTimersByTime(101);
        expect(await run(protectedTask, undefined)).toBe('SuccessPatternAfterOpenB');
        expect(globalMockLogger.info).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Trial request succeeded. State changed to CLOSED.`)
        );

        globalMockLogger.warn.mockClear();
        await expect(run(protectedTask, undefined)).rejects.toThrow('FailPattern3B');
        expect(globalMockLogger.warn).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Recorded failure #1.`),
          { error: expect.objectContaining({ message: 'FailPattern3B' }) }
        );

        expect(await run(protectedTask, undefined)).toBe('SuccessPatternAgainB');
        expect(await run(protectedTask, undefined)).toBe('SuccessPatternFinalB');
        expect(globalMockLogger.error).toHaveBeenCalledTimes(1);
        expect(globalMockLogger.error).toHaveBeenCalledWith(
          expect.stringContaining(`[Circuit Breaker: ${circuitId}] Failure threshold reached. State changed to OPEN.`)
        );
      });
    });
  });
});