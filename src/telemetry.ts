/**
 * @module
 * This module provides comprehensive OpenTelemetry integration for observability,
 * tracing, and metrics in your asynchronous workflows. The integration is designed
 * to work seamlessly with existing OpenTelemetry setups while providing graceful

 * fallbacks to a standard logger when OTel providers are not configured.
 */

import type { BaseContext, Task } from "./run.js";
import type { Logger } from "./run";

// --- Type Definitions for Telemetry ---

// By defining minimal "Like" interfaces, we avoid a hard dependency on @opentelemetry/api
// but still provide type guidance for users and for our own code.

interface SpanLike {
  setAttributes(attributes: Record<string, unknown>): void;
  setStatus(status: { code: number; message?: string }): void;
  recordException(exception: Error | string): void;
  end(): void;
}

interface TracerLike {
  startActiveSpan<F extends (span: SpanLike) => unknown>(
    name: string,
    options: any,
    fn: F,
  ): ReturnType<F>;
  getActiveSpan(): SpanLike | undefined;
  startSpan(name: string): SpanLike;
}

interface CounterLike {
  add(value: number, attributes?: Record<string, unknown>): void;
}
interface HistogramLike {
  record(value: number, attributes?: Record<string, unknown>): void;
}

interface MeterLike {
  createCounter(name: string, options?: any): CounterLike;
  createHistogram(name: string, options?: any): HistogramLike;
}

/**
 * The shape of a context that includes telemetry providers.
 * All providers are optional, allowing for graceful degradation.
 */
export interface TelemetryContext {
  telemetry?: {
    tracer?: TracerLike;
    meter?: MeterLike;
    logger?: Logger;
  };
}

/**
 * Options for configuring an OpenTelemetry span.
 */
export interface SpanOptions {
  name?: string;
  attributes?: Record<string, string | number | boolean>;
  kind?: "internal" | "server" | "client" | "producer" | "consumer";
}

/**
 * Options for configuring an OpenTelemetry metric.
 */
export interface MetricOptions {
  name: string;
  description?: string;
  unit?: string;
  attributes?: Record<string, string | number | boolean>;
}

// =================================================================
// Core Primitives
// =================================================================

/**
 * Creates a span around a task execution with OpenTelemetry integration.
 * Falls back to basic logging if no tracer is available.
 *
 * @param task The task to wrap with a span.
 * @param options Configuration for the span, including name and attributes.
 * @returns A new task that includes tracing logic.
 */
export function withSpan<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  options: SpanOptions = {},
): Task<C, V, R> {
  const enhancer: Task<C, V, R> = async (context: C, value: V): Promise<R> => {
    const tracer = context.telemetry?.tracer;
    const spanName = options.name || task.name || "anonymous_task";

    if (tracer && typeof tracer.startActiveSpan === "function") {
      return tracer.startActiveSpan(
        spanName,
        { kind: options.kind },
        async (span: SpanLike) => {
          try {
            if (options.attributes) {
              span.setAttributes(options.attributes);
            }
            const result = await task(context, value);
            span.setStatus({ code: 1 }); // 1 = OK
            return result;
          } catch (error: any) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message }); // 2 = ERROR
            throw error;
          } finally {
            span.end();
          }
        },
      );
    } else {
      // Fallback to basic logging
      const logger = context.telemetry?.logger || console;
      const startTime =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      logger.debug(`[Span Start] ${spanName}`);

      try {
        const result = await task(context, value);
        const duration =
          (typeof performance !== "undefined"
            ? performance.now()
            : Date.now()) - startTime;
        logger.info(
          `[Span End] ${spanName} - Success (${duration.toFixed(2)}ms)`,
        );
        return result;
      } catch (error) {
        const duration =
          (typeof performance !== "undefined"
            ? performance.now()
            : Date.now()) - startTime;
        logger.error(
          `[Span End] ${spanName} - Failure (${duration.toFixed(2)}ms)`,
          { error },
        );
        throw error;
      }
    }
  };

  Object.defineProperty(enhancer, "name", {
    value: `withSpan(${task.name || "anonymous"})`,
  });
  return enhancer;
}

/**
 * Records a metric value using an OpenTelemetry meter or falls back to logging.
 *
 * @param context The current execution context, which may contain telemetry providers.
 * @param type The type of metric to record ('counter' or 'histogram').
 * @param options Configuration for the metric.
 * @param value The value to record. Defaults to 1 for counters.
 */
export function recordMetric<C extends BaseContext & TelemetryContext>(
  context: C,
  type: "counter" | "histogram",
  options: MetricOptions,
  value: number = 1,
): void {
  const meter = context.telemetry?.meter;

  if (meter) {
    try {
      if (type === "counter" && typeof meter.createCounter === "function") {
        const counter = meter.createCounter(options.name, {
          description: options.description,
          unit: options.unit,
        });
        counter.add(value, options.attributes);
      } else if (
        type === "histogram" &&
        typeof meter.createHistogram === "function"
      ) {
        const histogram = meter.createHistogram(options.name, {
          description: options.description,
          unit: options.unit,
        });
        histogram.record(value, options.attributes);
      }
    } catch (metricError) {
      const logger = context.telemetry?.logger || console;
      logger.error(`[Telemetry] Failed to record metric '${options.name}'`, {
        error: metricError,
      });
    }
  } else {
    // Fallback logging
    const logger = context.telemetry?.logger || console;
    logger.debug(
      `[Metric] ${type}:${options.name} = ${value}`,
      options.attributes,
    );
  }
}

/**
 * Adds structured attributes to the current active OpenTelemetry span.
 * If no span is active, this function does nothing.
 */
export function addSpanAttributes<C extends BaseContext & TelemetryContext>(
  context: C,
  attributes: Record<string, string | number | boolean>,
): void {
  const tracer = context.telemetry?.tracer;
  if (tracer && typeof tracer.getActiveSpan === "function") {
    const span = tracer.getActiveSpan();
    if (span && typeof span.setAttributes === "function") {
      span.setAttributes(attributes);
    }
  }
}

/**
 * Records an exception in the current active OpenTelemetry span.
 * Falls back to logging if no tracer is available.
 */
export function recordSpanException<C extends BaseContext & TelemetryContext>(
  context: C,
  error: Error,
): void {
  const tracer = context.telemetry?.tracer;
  if (tracer && typeof tracer.getActiveSpan === "function") {
    const span = tracer.getActiveSpan();
    if (span && typeof span.recordException === "function") {
      span.recordException(error);
    }
  } else {
    const logger = context.telemetry?.logger || console;
    logger.error("[Exception]", { error: error.message, stack: error.stack });
  }
}

// =================================================================
// Higher-Level Tools
// =================================================================

/**
 * A method decorator that automatically wraps an async class method with an OpenTelemetry span.
 * The class instance must have a `context` property that conforms to `TelemetryContext`.
 *
 * @param spanName Optional. The name for the span. If not provided, it defaults to `ClassName.methodName`.
 */
export function traced(spanName?: string) {
  return function <
    This extends { context?: TelemetryContext },
    Args extends any[],
    Return,
  >(
    target: (this: This, ...args: Args) => Promise<Return>,
    context: ClassMethodDecoratorContext<
      This,
      (this: This, ...args: Args) => Promise<Return>
    >,
  ) {
    const methodName = String(context.name);

    function replacementMethod(this: This, ...args: Args): Promise<Return> {
      const tracer = this.context?.telemetry?.tracer;
      const name = spanName || `${this.constructor.name}.${methodName}`;

      if (tracer && typeof tracer.startActiveSpan === "function") {
        return tracer.startActiveSpan(name, {}, (span: SpanLike) => {
          return Promise.resolve(target.apply(this, args))
            .then((result) => {
              span.setStatus({ code: 1 }); // OK
              return result;
            })
            .catch((error) => {
              span.recordException(error);
              span.setStatus({ code: 2, message: error.message }); // ERROR
              throw error;
            })
            .finally(() => {
              span.end();
            });
        });
      } else {
        return target.apply(this, args);
      }
    }
    return replacementMethod;
  };
}

/**
 * An enhancer that wraps a task to automatically measure and record its execution time.
 *
 * @param task The task to time.
 * @param metricName The name for the histogram metric (e.g., 'database.query.duration').
 * @param attributes Optional static attributes to add to the metric.
 * @returns A new task with timing logic.
 */
export function withTiming<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  metricName: string,
  attributes?: Record<string, string | number | boolean>,
): Task<C, V, R> {
  const enhancer: Task<C, V, R> = async (context: C, value: V): Promise<R> => {
    const startTime =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    try {
      const result = await task(context, value);
      const duration =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        startTime;
      recordMetric(
        context,
        "histogram",
        {
          name: metricName,
          description: `Execution time for ${task.name || "task"}`,
          unit: "ms",
          attributes: { ...attributes, status: "success" },
        },
        duration,
      );
      return result;
    } catch (error) {
      const duration =
        (typeof performance !== "undefined" ? performance.now() : Date.now()) -
        startTime;
      recordMetric(
        context,
        "histogram",
        {
          name: metricName,
          description: `Execution time for ${task.name || "task"}`,
          unit: "ms",
          attributes: { ...attributes, status: "error" },
        },
        duration,
      );
      throw error;
    }
  };
  Object.defineProperty(enhancer, "name", {
    value: `withTiming(${task.name || "anonymous"})`,
  });
  return enhancer;
}

/**
 * An enhancer that wraps a task to count its successful and failed executions.
 *
 * @param task The task to count.
 * @param counterName The name for the counter metric (e.g., 'api_calls_total').
 * @param attributes Optional static attributes to add to the metric.
 * @returns A new task with counting logic.
 */
export function withCounter<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  counterName: string,
  attributes?: Record<string, string | number | boolean>,
): Task<C, V, R> {
  const enhancer: Task<C, V, R> = async (context: C, value: V): Promise<R> => {
    try {
      const result = await task(context, value);
      recordMetric(context, "counter", {
        name: counterName,
        description: `Execution count for ${task.name || "task"}`,
        attributes: { ...attributes, status: "success" },
      });
      return result;
    } catch (error) {
      recordMetric(context, "counter", {
        name: counterName,
        description: `Execution count for ${task.name || "task"}`,
        attributes: { ...attributes, status: "error" },
      });
      throw error;
    }
  };
  Object.defineProperty(enhancer, "name", {
    value: `withCounter(${task.name || "anonymous"})`,
  });
  return enhancer;
}

/**
 * A comprehensive observability enhancer that combines span tracing, timing, and counting.
 *
 * @param task The task to make observable.
 * @param options Configuration for the span and metrics.
 * @returns A new, fully observable task.
 */
export function withObservability<
  C extends BaseContext & TelemetryContext,
  V,
  R,
>(
  task: Task<C, V, R>,
  options: {
    spanName?: string;
    spanAttributes?: Record<string, string | number | boolean>;
    metricAttributes?: Record<string, string | number | boolean>;
    enableTiming?: boolean;
    enableCounting?: boolean;
    metricPrefix?: string;
  } = {},
): Task<C, V, R> {
  let wrappedTask = task;
  const name = options.spanName || task.name || "task";
  const metricPrefix = options.metricPrefix || name;

  if (options.enableCounting !== false) {
    wrappedTask = withCounter(
      wrappedTask,
      `${metricPrefix}.executions`,
      options.metricAttributes,
    );
  }
  if (options.enableTiming !== false) {
    wrappedTask = withTiming(
      wrappedTask,
      `${metricPrefix}.duration`,
      options.metricAttributes,
    );
  }

  wrappedTask = withSpan(wrappedTask, {
    name: name,
    attributes: options.spanAttributes,
  });

  Object.defineProperty(wrappedTask, "name", {
    value: `withObservability(${name})`,
  });
  return wrappedTask;
}

/**
 * A helper to create a context object containing telemetry providers.
 *
 * @param providers An object containing `tracer`, `meter`, and/or `logger` instances.
 * @returns A context fragment ready to be used in `createContext` or `run` overrides.
 */
export function createTelemetryContext(providers: {
  tracer?: TracerLike;
  meter?: MeterLike;
  logger?: Logger;
}): { telemetry: { tracer?: TracerLike; meter?: MeterLike; logger?: Logger } } {
  return {
    telemetry: providers,
  };
}

/**
 * Utility to safely access the current active span from the context.
 *
 * @param context The current execution context.
 * @returns The active span instance if available, otherwise `null`.
 */
export function getCurrentSpan<C extends BaseContext & TelemetryContext>(
  context: C,
): SpanLike | null {
  const tracer = context.telemetry?.tracer;
  return tracer && typeof tracer.getActiveSpan === "function"
    ? tracer.getActiveSpan() || null
    : null;
}

/**
 * Creates a child span from the current active span in the context.
 *
 * @param context The current execution context.
 * @param name The name for the new child span.
 * @param options Optional configuration for the child span.
 * @returns The new child span instance if a tracer is available, otherwise `null`.
 */
export function startChildSpan<C extends BaseContext & TelemetryContext>(
  context: C,
  name: string,
  options?: { attributes?: Record<string, string | number | boolean> },
): SpanLike | null {
  const tracer = context.telemetry?.tracer;
  if (!tracer || typeof tracer.startSpan !== "function") return null;

  const span = tracer.startSpan(name);
  if (options?.attributes) {
    span.setAttributes(options.attributes);
  }
  return span;
}
