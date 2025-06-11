import type { BaseContext, Task } from './run.js';

export interface TelemetryContext {
  telemetry?: {
    tracer?: any;
    meter?: any;
    logger?: any;
  };
}

export interface SpanOptions {
  name?: string;
  attributes?: Record<string, string | number | boolean>;
  kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer';
}

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
 */
export function withSpan<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  options: SpanOptions = {}
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const tracer = context.telemetry?.tracer;
    const spanName = options.name || task.name || 'anonymous_task';
    
    if (tracer) {
      // OpenTelemetry span
      return tracer.startActiveSpan(spanName, { kind: options.kind }, async (span: any) => {
        try {
          if (options.attributes) {
            span.setAttributes(options.attributes);
          }
          const result = await task(context, value);
          span.setStatus({ code: 1 }); // OK
          return result;
        } catch (error: any) {
          span.recordException(error);
          span.setStatus({ code: 2, message: error.message }); // ERROR
          throw error;
        } finally {
          span.end();
        }
      });
    } else {
      // Fallback to basic span logging (existing withSpan behavior)
      const logger = context.telemetry?.logger || console;
      const startTime = performance.now();
      logger.debug(`[Span Start] ${spanName}`);
      
      try {
        const result = await task(context, value);
        logger.info(`[Span End] ${spanName} - Success (${(performance.now() - startTime).toFixed(2)}ms)`);
        return result;
      } catch (error) {
        logger.error(`[Span End] ${spanName} - Failure (${(performance.now() - startTime).toFixed(2)}ms)`, { error });
        throw error;
      }
    }
  };
}

/**
 * Records a metric value using OpenTelemetry meter or fallback logging.
 */
export function recordMetric<C extends BaseContext & TelemetryContext>(
  context: C,
  type: 'counter' | 'histogram' | 'gauge',
  options: MetricOptions,
  value: number = 1
): void {
  const meter = context.telemetry?.meter;
  
  if (meter) {
    const instrument = meter[type === 'counter' ? 'createCounter' : 
                            type === 'histogram' ? 'createHistogram' : 
                            'createGauge'](options.name, {
      description: options.description,
      unit: options.unit
    });
    
    if (type === 'gauge') {
      instrument.record(value, options.attributes);
    } else {
      instrument.add(value, options.attributes);
    }
  } else {
    // Fallback logging
    const logger = context.telemetry?.logger || console;
    logger.debug(`[Metric] ${type}:${options.name} = ${value}`, options.attributes);
  }
}

/**
 * Adds structured attributes to the current active span.
 */
export function addSpanAttributes<C extends BaseContext & TelemetryContext>(
  context: C,
  attributes: Record<string, string | number | boolean>
): void {
  const tracer = context.telemetry?.tracer;
  if (tracer && tracer.getActiveSpan) {
    const span = tracer.getActiveSpan();
    if (span) {
      span.setAttributes(attributes);
    }
  }
}

/**
 * Records an exception in the current active span.
 */
export function recordSpanException<C extends BaseContext & TelemetryContext>(
  context: C,
  error: Error
): void {
  const tracer = context.telemetry?.tracer;
  if (tracer && tracer.getActiveSpan) {
    const span = tracer.getActiveSpan();
    if (span) {
      span.recordException(error);
    }
  } else {
    const logger = context.telemetry?.logger || console;
    logger.error('[Exception]', { error: error.message, stack: error.stack });
  }
}

// =================================================================
// Higher-Level Tools
// =================================================================

/**
 * Decorator that automatically wraps methods with OpenTelemetry spans.
 */
export function traced(spanName?: string) {
  return function <T extends (...args: any[]) => any>(
    target: any,
    propertyKey: string,
    descriptor: TypedPropertyDescriptor<T>
  ) {
    const originalMethod = descriptor.value;
    if (!originalMethod) return;

    descriptor.value = function (this: any, ...args: any[]) {
      const name = spanName || `${target.constructor.name}.${propertyKey}`;
      
      if (this.context?.telemetry?.tracer) {
        return this.context.telemetry.tracer.startActiveSpan(name, async (span: any) => {
          try {
            const result = await originalMethod.apply(this, args);
            span.setStatus({ code: 1 });
            return result;
          } catch (error: any) {
            span.recordException(error);
            span.setStatus({ code: 2, message: error.message });
            throw error;
          } finally {
            span.end();
          }
        });
      } else {
        return originalMethod.apply(this, args);
      }
    } as T;
  };
}

/**
 * Creates a task that automatically measures execution time.
 */
export function withTiming<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  metricName: string,
  attributes?: Record<string, string | number | boolean>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    const startTime = performance.now();
    try {
      const result = await task(context, value);
      const duration = performance.now() - startTime;
      recordMetric(context, 'histogram', {
        name: metricName,
        description: `Execution time for ${task.name || 'task'}`,
        unit: 'ms',
        attributes: { ...attributes, status: 'success' }
      }, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - startTime;
      recordMetric(context, 'histogram', {
        name: metricName,
        description: `Execution time for ${task.name || 'task'}`,
        unit: 'ms',
        attributes: { ...attributes, status: 'error' }
      }, duration);
      throw error;
    }
  };
}

/**
 * Creates a task that counts successful and failed executions.
 */
export function withCounter<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  counterName: string,
  attributes?: Record<string, string | number | boolean>
): Task<C, V, R> {
  return async (context: C, value: V): Promise<R> => {
    try {
      const result = await task(context, value);
      recordMetric(context, 'counter', {
        name: counterName,
        description: `Execution count for ${task.name || 'task'}`,
        attributes: { ...attributes, status: 'success' }
      });
      return result;
    } catch (error) {
      recordMetric(context, 'counter', {
        name: counterName,
        description: `Execution count for ${task.name || 'task'}`,
        attributes: { ...attributes, status: 'error' }
      });
      throw error;
    }
  };
}

/**
 * Combines span tracing with timing and counting metrics.
 */
export function withObservability<C extends BaseContext & TelemetryContext, V, R>(
  task: Task<C, V, R>,
  options: {
    spanName?: string;
    spanAttributes?: Record<string, string | number | boolean>;
    enableTiming?: boolean;
    enableCounting?: boolean;
    metricPrefix?: string;
  } = {}
): Task<C, V, R> {
  let wrappedTask = task;
  
  const metricPrefix = options.metricPrefix || task.name || 'task';
  
  if (options.enableCounting !== false) {
    wrappedTask = withCounter(wrappedTask, `${metricPrefix}_executions`);
  }
  
  if (options.enableTiming !== false) {
    wrappedTask = withTiming(wrappedTask, `${metricPrefix}_duration`);
  }
  
  wrappedTask = withSpan(wrappedTask, {
    name: options.spanName,
    attributes: options.spanAttributes
  });
  
  return wrappedTask;
}

/**
 * Creates a telemetry-enabled context with OpenTelemetry providers.
 */
export function createTelemetryContext(providers: {
  tracer?: any;
  meter?: any;
  logger?: any;
}): TelemetryContext {
  return {
    telemetry: providers
  };
}

/**
 * Utility to safely access current span from context.
 */
export function getCurrentSpan<C extends BaseContext & TelemetryContext>(
  context: C
): any | null {
  const tracer = context.telemetry?.tracer;
  return tracer?.getActiveSpan?.() || null;
}

/**
 * Creates a child span from the current active span.
 */
export function startChildSpan<C extends BaseContext & TelemetryContext>(
  context: C,
  name: string,
  options?: { attributes?: Record<string, string | number | boolean> }
): any | null {
  const tracer = context.telemetry?.tracer;
  if (!tracer) return null;
  
  const span = tracer.startSpan(name);
  if (options?.attributes) {
    span.setAttributes(options.attributes);
  }
  return span;
}
