import {
  describe,
  it,
  expect,
  beforeEach,
  vi,
  type MockedFunction,
  afterEach,
} from "vitest";
import { ok, err } from "neverthrow";
import {
  pipe,
  flow,
  createWorkflow,
  chain,
  fromValue,
  fromPromise,
  fromPromiseFn,
  map,
  flatMap,
  mapTask,
  andThenTask,
  pick,
  when,
  unless,
  doWhile,
  tap,
  sleep,
  tapError,
  attempt,
  withRetry,
  withName,
  memoize,
  once,
  withTimeout,
  withState,
  withThrottle,
  withPoll,
  createBatchingTask,
  withDebounce,
  type StateTools,
  type RetryOptions,
  type ThrottleOptions,
  type PollOptions,
  type BatchingOptions,
  PollTimeoutError,
  TimeoutError,
  useState,
} from "../src/utils";
import {
  createContext,
  defineTask,
  getContext,
  run,
  type BaseContext,
  type Task,
  WorkflowError,
} from "../src/run";

interface TestContext extends BaseContext {
  userId: string;
  logger?: {
    info: (msg: string, ...args: any[]) => void;
    warn: (msg: string, ...args: any[]) => void;
    error: (msg: string, ...args: any[]) => void;
    debug: (msg: string, ...args: any[]) => void;
  };
  counter: number;
  logs: string[];
}

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

const testContextDefaults: Omit<TestContext, "scope"> = {
  userId: "test-user",
  logger: mockLogger,
  counter: 0,
  logs: [],
};

describe("Composition Utilities (utils.ts)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Core composition functions", () => {
    describe("pipe", () => {
      it("should pipe a value through a sequence of functions", () => {
        const result = pipe(
          "  hello world  ",
          (s) => s.trim(),
          (s) => s.toUpperCase(),
          (s) => s.split(" "),
        );
        expect(result).toEqual(["HELLO", "WORLD"]);
      });

      it("should work with a single function", () => {
        const result = pipe(10, (x) => x * 2);
        expect(result).toBe(20);
      });

      it("should return the value unchanged when no functions provided", () => {
        const result = pipe(42);
        expect(result).toBe(42);
      });

      it("should handle complex transformations", () => {
        const result = pipe(
          50,
          (x) => x + 10,
          (x) => x * 2,
          (x) => x.toString(),
          (s) => `Result: ${s}`,
        );
        expect(result).toBe("Result: 120");
      });
    });

    describe("flow", () => {
      it("should compose functions from left to right", () => {
        const processString = flow(
          (s: string) => s.trim(),
          (s) => s.toUpperCase(),
          (s) => s.replace(" ", "_"),
        );

        const result = processString("  hello world  ");
        expect(result).toBe("HELLO_WORLD");
      });

      it("should handle functions with multiple arguments in first function", () => {
        const addAndProcess = flow(
          (a: number, b: number) => a + b,
          (sum) => sum * 2,
          (doubled) => `Result: ${doubled}`,
        );

        const result = addAndProcess(5, 3);
        expect(result).toBe("Result: 16");
      });

      it("should handle single function", () => {
        const identity = flow((x: number) => x);
        expect(identity(42)).toBe(42);
      });

      it("should handle no functions", () => {
        const identity = flow();
        expect(identity(42)).toBe(42);
      });
    });
  });

  describe("Workflow creation", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("createWorkflow and chain", () => {
      it("should chain tasks together sequentially", async () => {
        const addOne = defineTask(async (x: number) => x + 1);
        const multiplyByTwo = defineTask(async (x: number) => x * 2);
        const toString = defineTask(async (x: number) => x.toString());

        const workflow = createWorkflow(addOne, multiplyByTwo, toString);
        const result = await run(workflow, 5);
        expect(result).toBe("12"); // (5 + 1) * 2 = 12
      });

      it("should work with plain functions", async () => {
        const addOne = defineTask(async (x: number) => x + 1);
        const workflow = createWorkflow(
          addOne,
          (x: number) => x * 2, // Plain function
          (x: number) => x.toString(), // Plain function
        );

        const result = await run(workflow, 5);
        expect(result).toBe("12");
      });

      it("should handle single task workflow", async () => {
        const identity = defineTask(async (x: string) => x);
        const workflow = createWorkflow(identity);
        const result = await run(workflow, "test");
        expect(result).toBe("test");
      });

      it("should pass context through workflow", async () => {
        const contextTask = defineTask(async (input: string) => {
          const ctx = getContext<TestContext>();
          return `${input}-${ctx.userId}`;
        });

        const workflow = createWorkflow(contextTask);
        const result = await run(workflow, "hello");
        expect(result).toBe("hello-test-user");
      });

      it("should chain alias work identically", async () => {
        const addOne = defineTask(async (x: number) => x + 1);
        const multiplyByTwo = defineTask(async (x: number) => x * 2);

        const workflow1 = createWorkflow(addOne, multiplyByTwo);
        const workflow2 = chain(addOne, multiplyByTwo);

        const result1 = await run(workflow1, 5);
        const result2 = await run(workflow2, 5);
        expect(result1).toBe(result2);
        expect(result1).toBe(12);
      });
    });

    describe("Workflow starters", () => {
      describe("fromValue", () => {
        it("should start workflow with static value", async () => {
          const addOne = defineTask(async (x: number) => x + 1);
          const workflow = createWorkflow(fromValue(10), addOne);
          const result = await run(workflow, null);
          expect(result).toBe(11);
        });

        it("should work with complex objects", async () => {
          const data = { id: "user-123", name: "Test User" };
          const extractId = defineTask(async (user: typeof data) => user.id);
          const workflow = createWorkflow(fromValue(data), extractId);
          const result = await run(workflow, null);
          expect(result).toBe("user-123");
        });
      });

      describe("fromPromise", () => {
        it("should start workflow with promise", async () => {
          const userIdPromise = Promise.resolve("user-123");
          const addSuffix = defineTask(async (id: string) => `${id}-processed`);
          const workflow = createWorkflow(
            fromPromise(userIdPromise),
            addSuffix,
          );
          const result = await run(workflow, null);
          expect(result).toBe("user-123-processed");
        });

        it("should handle rejected promises", async () => {
          const rejectedPromise = Promise.reject(new Error("Promise failed"));
          const workflow = createWorkflow(fromPromise(rejectedPromise));
          await expect(run(workflow, null)).rejects.toThrow("Promise failed");
        });
      });

      describe("fromPromiseFn", () => {
        it("should start workflow with context-dependent function", async () => {
          const contextFn = (ctx: TestContext) => Promise.resolve(ctx.userId);
          const addSuffix = defineTask(async (id: string) => `${id}-processed`);
          const workflow = createWorkflow(fromPromiseFn(contextFn), addSuffix);
          const result = await run(workflow, null);
          expect(result).toBe("test-user-processed");
        });

        it("should pass context correctly", async () => {
          const contextFn = (ctx: TestContext) => Promise.resolve(ctx.counter);
          const workflow = createWorkflow(fromPromiseFn(contextFn));
          const result = await run(workflow, null, {
            overrides: { counter: 42 },
          });
          expect(result).toBe(42);
        });
      });
    });
  });

  describe("Pipeable operators", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("map", () => {
      it("should transform values in a workflow", async () => {
        const getData = defineTask(async () => ({ name: "John", age: 30 }));
        const workflow = createWorkflow(
          getData,
          map((user) => user.name),
        );
        const result = await run(workflow, null);
        expect(result).toBe("John");
      });

      it("should work with async mapping functions", async () => {
        const getData = defineTask(async () => "hello");
        const workflow = createWorkflow(
          getData,
          map(async (str: string) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return str.toUpperCase();
          }),
        );
        const promise = run(workflow, null);
        await vi.advanceTimersByTimeAsync(10);
        const result = await promise;
        expect(result).toBe("HELLO");
      });

      it("should pass context to mapping function", async () => {
        const getData = defineTask(async () => "data");
        const workflow = createWorkflow(
          getData,
          map(
            (value: string, context: TestContext) =>
              `${value}-${context.userId}`,
          ),
        );
        const result = await run(workflow, null);
        expect(result).toBe("data-test-user");
      });
    });

    describe("flatMap", () => {
      it("should transform values into new tasks", async () => {
        const getNumber = defineTask(async () => 5);
        const multiplyBy = (factor: number) =>
          defineTask(async (x: number) => x * factor);

        const workflow = createWorkflow(
          getNumber,
          flatMap((x: number) => multiplyBy(3)),
        );
        const result = await run(workflow, null);
        expect(result).toBe(15);
      });

      it("should pass context to flatMap function", async () => {
        const getData = defineTask(async () => "prefix");
        const workflow = createWorkflow(
          getData,
          flatMap((prefix: string, context: TestContext) =>
            defineTask(async () => `${prefix}-${context.userId}`),
          ),
        );
        const result = await run(workflow, null);
        expect(result).toBe("prefix-test-user");
      });
    });

    describe("pick", () => {
      it("should pick specified keys from object", async () => {
        const getUser = defineTask(async () => ({
          id: "123",
          name: "John",
          email: "john@example.com",
          age: 30,
        }));

        const workflow = createWorkflow(getUser, pick("id", "name"));
        const result = await run(workflow, null);
        expect(result).toEqual({ id: "123", name: "John" });
      });

      it("should handle missing keys gracefully", async () => {
        const getUser = defineTask(async () => ({ id: "123", name: "John" }));
        const workflow = createWorkflow(getUser, pick("id", "missing" as any));
        const result = await run(workflow, null);
        expect(result).toEqual({ id: "123" });
      });
    });
  });

  describe("Direct composition helpers", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("mapTask", () => {
      it("should transform task output", async () => {
        const getNumber = defineTask(async () => 42);
        const mappedTask = mapTask(getNumber, (x: number) => x.toString());
        const result = await run(mappedTask, null);
        expect(result).toBe("42");
      });

      it("should work with async mappers", async () => {
        const getNumber = defineTask(async () => 42);
        const mappedTask = mapTask(getNumber, async (x: number) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return x * 2;
        });
        const promise = run(mappedTask, null);
        await vi.advanceTimersByTimeAsync(10);
        const result = await promise;
        expect(result).toBe(84);
      });
    });

    describe("andThenTask", () => {
      it("should chain tasks with direct composition", async () => {
        const getUser = defineTask(async (id: string) => ({
          id,
          name: "John",
        }));
        const getProfile = (user: { id: string }) =>
          defineTask(async () => ({ userId: user.id, bio: "Developer" }));

        const composedTask = andThenTask(getUser, getProfile);
        const result = await run(composedTask, "user-123");
        expect(result).toEqual({ userId: "user-123", bio: "Developer" });
      });
    });
  });

  describe("Flow control and logic", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("when", () => {
      it("should execute task when predicate is true", async () => {
        const addSuffix = defineTask(async (str: string) => `${str}-processed`);
        const workflow = createWorkflow(
          fromValue("hello"),
          when((str: string) => str.length > 3, addSuffix),
        );
        const result = await run(workflow, null);
        expect(result).toBe("hello-processed");
      });

      it("should skip task when predicate is false", async () => {
        const addSuffix = defineTask(async (str: string) => `${str}-processed`);
        const workflow = createWorkflow(
          fromValue("hi"),
          when((str: string) => str.length > 3, addSuffix),
        );
        const result = await run(workflow, null);
        expect(result).toBe("hi");
      });

      it("should work with async predicates", async () => {
        const addSuffix = defineTask(async (str: string) => `${str}-processed`);
        const workflow = createWorkflow(
          fromValue("hello"),
          when(async (str: string) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return str.length > 3;
          }, addSuffix),
        );
        const promise = run(workflow, null);
        await vi.advanceTimersByTimeAsync(10);
        const result = await promise;
        expect(result).toBe("hello-processed");
      });

      it("should pass context to predicate", async () => {
        const addSuffix = defineTask(async (str: string) => `${str}-processed`);
        const workflow = createWorkflow(
          fromValue("hello"),
          when((str: string, ctx: TestContext) => ctx.counter === 0, addSuffix),
        );
        const result = await run(workflow, null);
        expect(result).toBe("hello-processed");
      });
    });

    describe("unless", () => {
      it("should execute task when predicate is false", async () => {
        const addSuffix = defineTask(async (str: string) => `${str}-processed`);
        const workflow = createWorkflow(
          fromValue("hi"),
          unless((str: string) => str.length > 3, addSuffix),
        );
        const result = await run(workflow, null);
        expect(result).toBe("hi-processed");
      });

      it("should skip task when predicate is true", async () => {
        const addSuffix = defineTask(async (str: string) => `${str}-processed`);
        const workflow = createWorkflow(
          fromValue("hello"),
          unless((str: string) => str.length > 3, addSuffix),
        );
        const result = await run(workflow, null);
        expect(result).toBe("hello");
      });
    });

    describe("doWhile", () => {
      it("should execute task repeatedly while condition is true", async () => {
        const incrementTask = defineTask(async (x: number) => x + 1);
        const workflow = doWhile(incrementTask, (x: number) => x < 5);
        const result = await run(workflow, 1);
        expect(result).toBe(5);
      });

      it("should not execute if condition is initially false", async () => {
        const incrementTask = defineTask(async (x: number) => x + 1);
        const workflow = doWhile(incrementTask, (x: number) => x < 5);
        const result = await run(workflow, 10);
        expect(result).toBe(10);
      });

      it("should respect abort signals", async () => {
        const incrementTask = defineTask(async (x: number) => {
          await new Promise((r) => setTimeout(r, 10));
          return x + 1;
        });
        const workflow = doWhile(incrementTask, () => true); // Infinite loop
        const controller = new AbortController();

        const promise = run(workflow, 1, { parentSignal: controller.signal });

        setTimeout(() => controller.abort(), 15);
        await vi.advanceTimersByTimeAsync(20);

        await expect(promise).rejects.toThrow("Workflow aborted");
      });
    });

    describe("tap", () => {
      it("should perform side effects without changing value", async () => {
        const logs: string[] = [];
        const sideEffect = (value: string) => {
          logs.push(value);
        };

        const workflow = createWorkflow(
          fromValue("hello"),
          tap(sideEffect),
          map((str: string) => str.toUpperCase()),
        );

        const result = await run(workflow, null);
        expect(result).toBe("HELLO");
        expect(logs).toEqual(["hello"]);
      });

      it("should work with async side effects", async () => {
        const logs: string[] = [];
        const asyncSideEffect = async (value: string) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          logs.push(value);
        };

        const workflow = createWorkflow(
          fromValue("hello"),
          tap(asyncSideEffect),
        );

        const promise = run(workflow, null);
        await vi.advanceTimersByTimeAsync(10);
        const result = await promise;
        expect(result).toBe("hello");
        expect(logs).toEqual(["hello"]);
      });

      it("should pass context to side effect function", async () => {
        let capturedUserId: string = "";
        const sideEffect = (value: string, context: TestContext) => {
          capturedUserId = context.userId;
        };

        const workflow = createWorkflow(fromValue("hello"), tap(sideEffect));

        await run(workflow, null);
        expect(capturedUserId).toBe("test-user");
      });
    });

    describe("sleep", () => {
      it("should pause workflow for specified duration", async () => {
        const workflow = createWorkflow(
          fromValue("before"),
          sleep(100),
          map(() => "after"),
        );

        const promise = run(workflow, null);
        await vi.advanceTimersByTimeAsync(100);
        const result = await promise;

        expect(result).toBe("after");
      });

      it("should respect abort signals", async () => {
        const controller = new AbortController();
        const workflow = sleep(1000);

        const promise = run(workflow, null, {
          parentSignal: controller.signal,
        });

        // Abort immediately, don't wait for timers
        controller.abort();

        await expect(promise).rejects.toThrow("Aborted");
      });
    });
  });

  describe("Error handling and resilience", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("tapError", () => {
      it("should perform side effects on error without catching it", async () => {
        let errorLogged = false;
        const sideEffect = () => {
          errorLogged = true;
        };

        const failingTask = defineTask(async () => {
          throw new Error("Task failed");
        });

        const workflow = tapError(failingTask, sideEffect);

        await expect(run(workflow, null)).rejects.toThrow("Task failed");
        expect(errorLogged).toBe(true);
      });

      it("should not perform side effect on success", async () => {
        let errorLogged = false;
        const sideEffect = () => {
          errorLogged = true;
        };

        const successTask = defineTask(async () => "success");
        const workflow = tapError(successTask, sideEffect);

        const result = await run(workflow, null);
        expect(result).toBe("success");
        expect(errorLogged).toBe(false);
      });

      it("should pass context to error handler", async () => {
        let capturedUserId = "";
        const errorHandler = (error: unknown, context: TestContext) => {
          capturedUserId = context.userId;
        };

        const failingTask = defineTask(async () => {
          throw new Error("Task failed");
        });

        const workflow = tapError(failingTask, errorHandler);

        await expect(run(workflow, null)).rejects.toThrow("Task failed");
        expect(capturedUserId).toBe("test-user");
      });
    });

    describe("attempt", () => {
      it("should convert exceptions to Result type", async () => {
        const failingTask = defineTask(async () => {
          throw new Error("Task failed");
        });

        const workflow = createWorkflow(
          fromValue(null),
          attempt(failingTask),
          map((result) => (result.isErr() ? "error" : "success")),
        );

        const result = await run(workflow, null);
        expect(result).toBe("error");
      });

      it("should wrap successful results in Ok", async () => {
        const successTask = defineTask(async () => "success");

        const workflow = createWorkflow(
          fromValue(null),
          attempt(successTask),
          map((result) => (result.isOk() ? result.value : "error")),
        );

        const result = await run(workflow, null);
        expect(result).toBe("success");
      });
    });

    describe("withRetry", () => {
      it("should retry failed tasks", async () => {
        let attempts = 0;
        const flakyTask = defineTask(async () => {
          attempts++;
          if (attempts < 3) throw new Error("Temporary failure");
          return "success";
        });

        const resilientTask = withRetry(flakyTask, {
          attempts: 3,
          delayMs: 10,
        });

        // Manually advance timers for each retry
        const promise = run(resilientTask, null);
        await vi.advanceTimersByTimeAsync(10); // 1st retry
        await vi.advanceTimersByTimeAsync(10); // 2nd retry

        const result = await promise;
        expect(result).toBe("success");
        expect(attempts).toBe(3);
      });

      it("should fail after max attempts", async () => {
        let attempts = 0;
        const alwaysFailingTask = defineTask(async () => {
          attempts++;
          throw new Error("Always fails");
        });

        const resilientTask = withRetry(alwaysFailingTask, {
          attempts: 2,
          delayMs: 10,
        });

        const promise = run(resilientTask, null);
        await vi.advanceTimersByTimeAsync(10); // for the first retry delay

        await expect(promise).rejects.toThrow("Always fails");
        expect(attempts).toBe(2);
      });

      it("should use exponential backoff", async () => {
        let attempts = 0;
        const flakyTask = defineTask(async () => {
          attempts++;
          throw new Error("Temporary failure");
        });

        const resilientTask = withRetry(flakyTask, {
          attempts: 3,
          delayMs: 100,
          backoff: "exponential",
        });
        const promise = run(resilientTask, null);

        await vi.advanceTimersByTimeAsync(100); // Wait for 1st retry delay
        await vi.advanceTimersByTimeAsync(200); // Wait for 2nd retry delay

        await expect(promise).rejects.toThrow("Temporary failure");
        expect(attempts).toBe(3);
      });

      it("should respect shouldRetry predicate", async () => {
        let attempts = 0;
        const flakyTask = defineTask(async () => {
          attempts++;
          throw new Error("Network error");
        });
        const resilientTask = withRetry(flakyTask, {
          attempts: 3,
          delayMs: 10,
          shouldRetry: (error) => (error as Error).message.includes("Network"),
        });
        const promise = run(resilientTask, null);

        // Advance for both retries
        await vi.advanceTimersByTimeAsync(10);
        await vi.advanceTimersByTimeAsync(10);

        await expect(promise).rejects.toThrow("Network error");
        expect(attempts).toBe(3);
      });

      it("should not retry when shouldRetry returns false", async () => {
        let attempts = 0;
        const flakyTask = defineTask(async () => {
          attempts++;
          throw new Error("Auth error");
        });

        const resilientTask = withRetry(flakyTask, {
          attempts: 3,
          shouldRetry: (error) => (error as Error).message.includes("Network"),
        });

        await expect(run(resilientTask, null)).rejects.toThrow("Auth error");
        expect(attempts).toBe(1);
      });
    });
  });

  describe("Task enhancers", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("withName", () => {
      it("should attach name to task", async () => {
        const task = defineTask(async (x: number) => x * 2);
        const namedTask = withName(task, "DoubleTask");

        expect(namedTask.name).toBe("DoubleTask");

        const result = await run(namedTask, 5);
        expect(result).toBe(10);
      });

      it("should preserve task functionality", async () => {
        const task = defineTask(async (x: number) => x + 1);
        const namedTask = withName(task, "IncrementTask");

        const result = await run(namedTask, 9);
        expect(result).toBe(10);
      });
    });

    describe("memoize", () => {
      it("should cache results based on input", async () => {
        let callCount = 0;
        const expensiveTask = defineTask(async (x: number) => {
          callCount++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return x * 2;
        });

        const memoizedTask = memoize(expensiveTask);

        const p1 = run(memoizedTask, 5);
        await vi.advanceTimersByTimeAsync(10);

        const result1 = await p1;
        const result2 = await run(memoizedTask, 5);

        const p3 = run(memoizedTask, 10);
        await vi.advanceTimersByTimeAsync(10);
        const result3 = await p3;

        expect(result1).toBe(10);
        expect(result2).toBe(10);
        expect(result3).toBe(20);
        expect(callCount).toBe(2);
      });

      it("should use deep equality for cache keys", async () => {
        let callCount = 0;
        const taskWithObjectInput = defineTask(
          async (obj: { id: number; name: string }) => {
            callCount++;
            return `${obj.name}-${obj.id}`;
          },
        );

        const memoizedTask = memoize(taskWithObjectInput);

        const input1 = { id: 1, name: "test" };
        const input2 = { id: 1, name: "test" };
        const input3 = { id: 2, name: "test" };

        const result1 = await run(memoizedTask, input1);
        const result2 = await run(memoizedTask, input2);
        const result3 = await run(memoizedTask, input3);

        expect(result1).toBe("test-1");
        expect(result2).toBe("test-1");
        expect(result3).toBe("test-2");
        expect(callCount).toBe(2);
      });
    });

    describe("once", () => {
      it("should execute task only once", async () => {
        let callCount = 0;
        const initTask = defineTask(async () => {
          callCount++;
          return "initialized";
        });

        const onceTask = once(initTask);

        const result1 = await run(onceTask, null);
        const result2 = await run(onceTask, null);
        const result3 = await run(onceTask, null);

        expect(result1).toBe("initialized");
        expect(result2).toBe("initialized");
        expect(result3).toBe("initialized");
        expect(callCount).toBe(1);
      });

      it("should share the same promise across calls", async () => {
        let callCount = 0;
        const asyncTask = defineTask(async () => {
          callCount++;
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "done";
        });

        const onceTask = once(asyncTask);

        const promise1 = run(onceTask, null);
        const promise2 = run(onceTask, null);

        await vi.advanceTimersByTimeAsync(100);

        const [result1, result2] = await Promise.all([promise1, promise2]);

        expect(result1).toBe("done");
        expect(result2).toBe("done");
        expect(callCount).toBe(1);
      });
    });

    describe("withTimeout", () => {
      it("should timeout long-running tasks", async () => {
        const longTask = defineTask(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "completed";
        });

        const timedTask = withTimeout(longTask, 500);
        const promise = run(timedTask, null);

        await vi.advanceTimersByTimeAsync(500);

        await expect(promise).rejects.toThrow("timed out after 500ms");
      });

      it("should complete fast tasks normally", async () => {
        const fastTask = defineTask(async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return "completed";
        });

        const timedTask = withTimeout(fastTask, 500);
        const promise = run(timedTask, null);

        await vi.advanceTimersByTimeAsync(100);
        const result = await promise;

        expect(result).toBe("completed");
      });

      it("should clean up timers on abort", async () => {
        const longTask = defineTask(async () => {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return "completed";
        });
        const timedTask = withTimeout(longTask, 500);
        const controller = new AbortController();

        const promise = run(timedTask, null, {
          parentSignal: controller.signal,
        });

        setTimeout(() => controller.abort(), 10);
        await vi.advanceTimersByTimeAsync(10);

        await expect(promise).rejects.toThrow("Aborted");
      });
    });

    describe("withState", () => {
      it("should manage stateful workflows and provide tools via context", async () => {
        type MyState = { count: number };
        const innerTask = defineTask(async () => {
          const ctx = getContext(); // Correctly get context
          const { getState, setState } = useState<MyState>(ctx);
          setState({ count: getState().count + 1 });
          return getState().count;
        });
        const statefulWorkflow = withState({ count: 10 }, innerTask);
        const result = await run(statefulWorkflow, undefined);
        expect(result.result).toBe(11);
        expect(result.state).toEqual({ count: 11 });
      });

      it("should initialize state with a static value", async () => {
        const innerTask = defineTask(async () => {
          // Use getContext() to get the context inside the task
          const ctx = getContext();
          const { getState } = useState<{ message: string }>(ctx);
          return getState().message;
        });

        const statefulWorkflow = withState(
          { message: "Hello State" }, // Static initial state
          innerTask,
        );

        const result = await run(statefulWorkflow, null);

        expect(result.result).toBe("Hello State");
        expect(result.state).toEqual({ message: "Hello State" });
      });

      it("should throw if useState is used outside a withState context", async () => {
        // FIX: The task function should only take one argument (value).
        // The context is retrieved internally with getContext().
        const taskWithoutState = defineTask(async (_) => {
          const ctx = getContext();
          // This call should fail because `withState` is not used to wrap this task,
          // so the STATE_TOOLS_KEY will not be in the context.
          useState(ctx);
        });

        await expect(run(taskWithoutState, null)).rejects.toThrow(
          "useState() can only be used within a task wrapped by withState()",
        );
      });
    });
  });

  describe("Advanced scheduling and batching", () => {
    const { run, defineTask } = createContext<TestContext>(testContextDefaults);

    describe("withThrottle", () => {
      it("should throttle task execution", async () => {
        let callCount = 0;
        const task = defineTask(async (x: number) => {
          callCount++;
          return x * 2;
        });

        const throttledTask = withThrottle(task, { limit: 2, intervalMs: 100 });

        const promises = [1, 2, 3, 4, 5].map((x) => run(throttledTask, x));

        await vi.runAllTimersAsync();

        const results = await Promise.all(promises);
        expect(results).toEqual([2, 4, 6, 8, 10]);
        expect(callCount).toBe(5);
      });

      it("should respect abort signals in throttle queue", async () => {
        const task = defineTask(async (x: number) => {
          await new Promise((r) => setTimeout(r, 10));
          return x * 2;
        });
        const throttledTask = withThrottle(task, {
          limit: 1,
          intervalMs: 1000,
        });

        const controller = new AbortController();

        const promise1 = run(throttledTask, 1);
        const promise2 = run(throttledTask, 2, {
          parentSignal: controller.signal,
        });

        controller.abort();

        await vi.advanceTimersByTimeAsync(10);
        const result1 = await promise1;
        expect(result1).toBe(2);

        await expect(promise2).rejects.toThrow("Aborted");
      });
    });

    describe("withPoll", () => {
      it("should poll until condition is met", async () => {
        let attempts = 0;
        const checkStatus = defineTask(async () => {
          attempts++;
          return { done: attempts >= 3, result: `attempt-${attempts}` };
        });

        const pollingTask = withPoll(checkStatus, {
          intervalMs: 100,
          timeoutMs: 1000,
          until: (result) => result.done,
        });

        const promise = run(pollingTask, null);

        await vi.advanceTimersByTimeAsync(300);

        const result = await promise;
        expect(result.result).toBe("attempt-3");
        expect(attempts).toBe(3);
      });

      it("should timeout if condition is never met", async () => {
        const checkStatus = defineTask(async () => ({ done: false }));
        const pollingTask = withPoll(checkStatus, {
          intervalMs: 100,
          timeoutMs: 250,
          until: (result) => result.done,
        });
        const promise = run(pollingTask, null);
        await vi.advanceTimersByTimeAsync(250);

        try {
          await promise;
          expect.fail("Should have thrown");
        } catch (e) {
          expect(e).toBeInstanceOf(WorkflowError);
          expect((e as WorkflowError).cause).toBeInstanceOf(PollTimeoutError);
        }
      });
    });

    describe("createBatchingTask", () => {
      it("should batch multiple calls", async () => {
        let batchCount = 0;
        const batchFn = async (keys: string[]) => {
          batchCount++;
          return keys.map((key) => `result-${key}`);
        };

        const batchedTask = createBatchingTask(batchFn, { windowMs: 10 });

        const promises = ["a", "b", "c"].map((key) => run(batchedTask, key));

        await vi.advanceTimersByTimeAsync(10);
        const results = await Promise.all(promises);

        expect(results).toEqual(["result-a", "result-b", "result-c"]);
        expect(batchCount).toBe(1);
      });

      it("should handle batch function errors", async () => {
        const batchFn = async (keys: string[]) => {
          throw new Error("Batch failed");
        };

        const batchedTask = createBatchingTask(batchFn, { windowMs: 10 });

        const promises = ["a", "b"].map((key) => run(batchedTask, key));

        await vi.advanceTimersByTimeAsync(10);

        await Promise.all(
          promises.map((p) => expect(p).rejects.toThrow("Batch failed")),
        );
      });

      it("should respect abort signals in batch queue", async () => {
        const batchFn = async (keys: string[]) =>
          keys.map((key) => `result-${key}`);
        const batchedTask = createBatchingTask(batchFn, { windowMs: 100 });
        const controller = new AbortController();

        const promise1 = run(batchedTask, "a");
        const promise2 = run(batchedTask, "b", {
          parentSignal: controller.signal,
        });

        // Abort before the batch window closes.
        controller.abort();

        await vi.advanceTimersByTimeAsync(100);

        const result1 = await promise1;
        expect(result1).toBe("result-a");

        // The promise for the aborted call should reject.
        await expect(promise2).rejects.toThrow(
          "Call aborted before batch dispatch",
        );
      });
    });

    describe("withDebounce", () => {
      it("should debounce rapid calls", async () => {
        let callCount = 0;
        const task = defineTask(async (x: string) => {
          callCount++;
          return `processed-${x}`;
        });

        const debouncedTask = withDebounce(task, 100);

        const promise1 = run(debouncedTask, "first");
        const promise2 = run(debouncedTask, "second");
        const promise3 = run(debouncedTask, "third");

        await vi.advanceTimersByTimeAsync(100);

        const results = await Promise.all([promise1, promise2, promise3]);

        expect(results).toEqual([
          "processed-third",
          "processed-third",
          "processed-third",
        ]);
        expect(callCount).toBe(1);
      });

      it("should execute after debounce period", async () => {
        let callCount = 0;
        const task = defineTask(async (x: string) => {
          callCount++;
          return `processed-${x}`;
        });

        const debouncedTask = withDebounce(task, 50);

        const promise1 = run(debouncedTask, "first");
        await vi.advanceTimersByTimeAsync(50);
        const result1 = await promise1;

        expect(result1).toBe("processed-first");
        expect(callCount).toBe(1);

        const promise2 = run(debouncedTask, "second");
        await vi.advanceTimersByTimeAsync(50);
        const result2 = await promise2;

        expect(result2).toBe("processed-second");
        expect(callCount).toBe(2);
      });
    });
  });
});
