import { describe, it, expect, beforeEach, vi } from "vitest";
import { createContext, defineTask, run, type BaseContext } from "../src/run";
import {
  withSpan,
  recordMetric,
  withTiming,
  withCounter,
  withObservability,
  addSpanAttributes,
  recordSpanException,
  getCurrentSpan,
  traced,
  type TelemetryContext,
  createTelemetryContext,
} from "../src/telemetry";

// --- 1. Mock OpenTelemetry Objects ---
const mockSpan = {
  setAttributes: vi.fn(),
  setStatus: vi.fn(),
  recordException: vi.fn(),
  end: vi.fn(),
};

const mockTracer = {
  startActiveSpan: vi.fn((_name, _options, fn) => {
    // The real API can have context as the 3rd arg. This mock simplifies.
    // It immediately executes the provided function with the mock span.
    return fn(mockSpan);
  }),
  getActiveSpan: vi.fn(() => mockSpan),
};

const mockCounter = { add: vi.fn() };
const mockHistogram = { record: vi.fn() };
const mockGauge = { record: vi.fn() };

const mockMeter = {
  createCounter: vi.fn(() => mockCounter),
  createHistogram: vi.fn(() => mockHistogram),
  createGauge: vi.fn(() => mockGauge),
};

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// --- 2. Define Test Context and Tools ---
interface TestContext extends BaseContext, TelemetryContext {}

const { run: testRun, defineTask: testDefineTask } = createContext<TestContext>(
  {},
);

// Helper to create a context with telemetry providers for a test
const getTelCtx = (
  providers: { tracer?: any; meter?: any; logger?: any } = {},
) => {
  return {
    overrides: createTelemetryContext(providers),
  };
};

// --- 3. Test Suite ---
describe("Telemetry (telemetry.ts)", () => {
  beforeEach(() => {
    // Reset all mocks before each test
    vi.clearAllMocks();
  });

  describe("withSpan", () => {
    it("should create a span, set status OK on success, and return task result", async () => {
      const task = testDefineTask(async () => "success");
      const tracedTask = withSpan(task, {
        name: "my-span",
        attributes: { key: "value" },
      });

      const result = await testRun(
        tracedTask,
        undefined,
        getTelCtx({ tracer: mockTracer }),
      );

      expect(result).toBe("success");
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        "my-span",
        expect.any(Object),
        expect.any(Function),
      );
      expect(mockSpan.setAttributes).toHaveBeenCalledWith({ key: "value" });
      expect(mockSpan.setStatus).toHaveBeenCalledWith({ code: 1 }); // 1 = OK
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should create a span, record exception, set status ERROR on failure, and re-throw", async () => {
      const error = new Error("Task Failed");
      const task = testDefineTask(async () => {
        throw error;
      });
      const tracedTask = withSpan(task, { name: "failing-span" });

      await expect(
        testRun(tracedTask, undefined, getTelCtx({ tracer: mockTracer })),
      ).rejects.toThrow("Task Failed");

      expect(mockTracer.startActiveSpan).toHaveBeenCalled();
      expect(mockSpan.recordException).toHaveBeenCalledWith(error);
      expect(mockSpan.setStatus).toHaveBeenCalledWith({
        code: 2,
        message: "Task Failed",
      }); // 2 = ERROR
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should fall back to logging when no tracer is available", async () => {
      const task = testDefineTask(async () => "success");
      const tracedTask = withSpan(task, { name: "fallback-span" });

      await testRun(tracedTask, undefined, getTelCtx({ logger: mockLogger }));

      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "[Span Start] fallback-span",
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("[Span End] fallback-span - Success"),
      );
    });
  });

  describe("recordMetric", () => {
    it("should record a counter metric", () => {
      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        telemetry: { meter: mockMeter },
      };
      recordMetric(
        context,
        "counter",
        { name: "my.counter", attributes: { a: 1 } },
        5,
      );

      expect(mockMeter.createCounter).toHaveBeenCalledWith(
        "my.counter",
        expect.any(Object),
      );
      expect(mockCounter.add).toHaveBeenCalledWith(5, { a: 1 });
    });

    it("should record a histogram metric", () => {
      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        telemetry: { meter: mockMeter },
      };
      recordMetric(
        context,
        "histogram",
        { name: "my.histogram", unit: "ms" },
        123,
      );

      expect(mockMeter.createHistogram).toHaveBeenCalledWith(
        "my.histogram",
        expect.any(Object),
      );
      expect(mockHistogram.record).toHaveBeenCalledWith(123, undefined);
    });

    it("should fall back to logging when no meter is available", () => {
      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        telemetry: { logger: mockLogger },
      };
      recordMetric(context, "counter", { name: "my.fallback.counter" }, 1);

      expect(mockMeter.createCounter).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        "[Metric] counter:my.fallback.counter = 1",
        undefined,
      );
    });
  });

  describe("Higher-Level Enhancers", () => {
    it("withTiming should record a histogram on success and failure", async () => {
      const successTask = withTiming(
        testDefineTask(async () => {}),
        "my.timed.task",
      );
      await testRun(successTask, undefined, getTelCtx({ meter: mockMeter }));

      expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
        status: "success",
      });

      const failingTask = withTiming(
        testDefineTask(async () => {
          throw new Error("fail");
        }),
        "my.timed.task",
      );
      await expect(
        testRun(failingTask, undefined, getTelCtx({ meter: mockMeter })),
      ).rejects.toThrow();

      expect(mockHistogram.record).toHaveBeenCalledWith(expect.any(Number), {
        status: "error",
      });
    });

    it("withCounter should increment on success and failure", async () => {
      const successTask = withCounter(
        testDefineTask(async () => {}),
        "my.counted.task",
      );
      await testRun(successTask, undefined, getTelCtx({ meter: mockMeter }));
      expect(mockCounter.add).toHaveBeenCalledWith(1, { status: "success" });

      const failingTask = withCounter(
        testDefineTask(async () => {
          throw new Error("fail");
        }),
        "my.counted.task",
      );
      await expect(
        testRun(failingTask, undefined, getTelCtx({ meter: mockMeter })),
      ).rejects.toThrow();
      expect(mockCounter.add).toHaveBeenCalledWith(1, { status: "error" });
    });

    it("withObservability should call span, timer, and counter logic", async () => {
      const task = testDefineTask(async () => "ok");
      const observedTask = withObservability(task, { spanName: "observed" });

      await testRun(
        observedTask,
        undefined,
        getTelCtx({ tracer: mockTracer, meter: mockMeter }),
      );

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        "observed",
        expect.any(Object),
        expect.any(Function),
      );
      expect(mockMeter.createHistogram).toHaveBeenCalledWith(
        "observed.duration",
        expect.any(Object),
      );
      expect(mockHistogram.record).toHaveBeenCalled();
      expect(mockMeter.createCounter).toHaveBeenCalledWith(
        "observed_executions",
        expect.any(Object),
      );
      expect(mockCounter.add).toHaveBeenCalled();
    });
  });

  describe("Manual Span Helpers", () => {
    it("addSpanAttributes should call setAttributes on the active span", () => {
      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        // @ts-ignore
        telemetry: { tracer: mockTracer },
      };

      // Simulate an active span context
      mockTracer.startActiveSpan("parent", {}, (span: any) => {
        addSpanAttributes(context, { "user.id": "123" });
        expect(span.setAttributes).toHaveBeenCalledWith({ "user.id": "123" });
      });
    });

    it("recordSpanException should call recordException on the active span", () => {
      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        // @ts-ignore
        telemetry: { tracer: mockTracer },
      };
      const error = new Error("test exception");

      mockTracer.startActiveSpan("parent", {}, (span: any) => {
        recordSpanException(context, error);
        expect(span.recordException).toHaveBeenCalledWith(error);
      });
    });

    it("getCurrentSpan should return the active span", () => {
      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        // @ts-ignore
        telemetry: { tracer: mockTracer },
      };
      const span = getCurrentSpan(context);
      expect(span).toBe(mockSpan);
      expect(mockTracer.getActiveSpan).toHaveBeenCalled();
    });
  });

  describe("@traced Decorator", () => {
    it("should wrap a class method with a span", async () => {
      class MyService {
        constructor(public context: TestContext) {}

        @traced("my-service-method")
        async doWork(input: string): Promise<string> {
          return `work done on ${input}`;
        }
      }

      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        // @ts-ignore
        telemetry: { tracer: mockTracer },
      };
      const service = new MyService(context);

      const result = await service.doWork("test");

      expect(result).toBe("work done on test");
      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        "my-service-method",
        {},
        expect.any(Function),
      );
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it("should use class.method as default span name", async () => {
      class MyOtherService {
        constructor(public context: TestContext) {}

        @traced()
        async anotherMethod() {}
      }

      const context: TestContext = {
        scope: { signal: new AbortController().signal },
        // @ts-ignore
        telemetry: { tracer: mockTracer },
      };
      const service = new MyOtherService(context);
      await service.anotherMethod();

      expect(mockTracer.startActiveSpan).toHaveBeenCalledWith(
        "MyOtherService.anotherMethod",
        expect.any(Function),
      );
    });

    it("should not wrap if no tracer is present in context", async () => {
      class MyService {
        constructor(public context: TestContext) {}

        @traced()
        async doWork() {}
      }

      const context: TestContext = {
        scope: { signal: new AbortController().signal },
      }; // No telemetry
      const service = new MyService(context);
      await service.doWork();

      expect(mockTracer.startActiveSpan).not.toHaveBeenCalled();
    });
  });
});
