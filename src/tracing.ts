// import { asAsync, AsyncEffect, Effect, ensurePromise, flow, UnwrapPromise } from "./composition"
import type { Effect, EnhancedEffect } from "./createEffect"

const identity = <A extends any[], R>(effect: Effect<A, R>): Effect<A, R> => effect;

// Core types for observability
export interface SpanContext {
  traceId: string
  spanId: string
  parentId?: string
  baggage: Map<string, string>
}

export interface Span {
  id: string
  name: string
  kind: SpanKind
  traceId: string
  parentId?: string
  startTime: number
  endTime?: number
  status: SpanStatus
  attributes: Record<string, unknown>
  events: SpanEvent[]
  links: SpanLink[]
}

export interface SpanEvent {
  name: string
  timestamp: number
  attributes?: Record<string, unknown>
}

export interface SpanLink {
  spanId: string
  traceId: string
  attributes?: Record<string, unknown>
}

export enum SpanKind {
  INTERNAL = 'internal',
  SERVER = 'server',
  CLIENT = 'client',
  PRODUCER = 'producer',
  CONSUMER = 'consumer'
}

export enum SpanStatus {
  UNSET = 'unset',
  OK = 'ok',
  ERROR = 'error'
}

// Metrics types
export interface Metric<T> {
  name: string
  value: T
  timestamp: number
  labels: Record<string, string>
  type: MetricType
}

export enum MetricType {
  COUNTER = 'counter',
  GAUGE = 'gauge',
  HISTOGRAM = 'histogram'
}

// Log types
export interface LogRecord {
  timestamp: number
  level: LogLevel
  message: string
  context: Record<string, unknown>
  spanId?: string
  traceId?: string
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// Observability context
export interface ObservabilityContext {
  span?: Span
  metrics: MetricCollector
  logger: Logger
}


// Higher-order functions for observability
export interface TracingOptions {
  name: string
  kind?: SpanKind
  attributes?: Record<string, unknown>
}



// Core types stay the same, updating from line ~200 onwards

// Types remain the same until ObservabilityContext...

export interface ObservabilityContext {
  span?: Span
  metrics: MetricCollector
  logger: Logger
  baggage: Map<string, string>
}

export class SpanProcessor {
  constructor(private readonly onSpan: (span: Span) => Promise<void>) {}

  async processSpan(span: Span): Promise<void> {
    await this.onSpan(span)
  }
}

export class MetricCollector {
  private metrics: Metric<unknown>[] = []

  record<T>(metric: Metric<T>): void {
    this.metrics.push(metric)
  }

  counter(name: string, value: number, labels: Record<string, string> = {}): void {
    this.record({
      name,
      value,
      timestamp: Date.now(),
      labels,
      type: MetricType.COUNTER
    })
  }

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    this.record({
      name,
      value,
      timestamp: Date.now(),
      labels,
      type: MetricType.GAUGE
    })
  }

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    this.record({
      name,
      value,
      timestamp: Date.now(),
      labels,
      type: MetricType.HISTOGRAM
    })
  }

  getMetrics(): readonly Metric<unknown>[] {
    return this.metrics
  }
}

export class Logger {
  constructor(
    private readonly onLog: (record: LogRecord) => Promise<void>,
    private readonly context: Record<string, unknown> = {}
  ) {}

  log(level: LogLevel, message: string, context: Record<string, unknown> = {}): void {
    const observabilityContext = getObservabilityContext()
    const record: LogRecord = {
      timestamp: Date.now(),
      level,
      message,
      context: {
        ...this.context,
        ...context
      },
      spanId: observabilityContext?.span?.id,
      traceId: observabilityContext?.span?.traceId
    }
    this.onLog(record).catch(error =>
      console.error('Error in logger:', error)
    )
  }

  debug = (message: string, context?: Record<string, unknown>): void =>
    this.log(LogLevel.DEBUG, message, context)

  info = (message: string, context?: Record<string, unknown>): void =>
    this.log(LogLevel.INFO, message, context)

  warn = (message: string, context?: Record<string, unknown>): void =>
    this.log(LogLevel.WARN, message, context)

  error = (message: string, context?: Record<string, unknown>): void =>
    this.log(LogLevel.ERROR, message, context)
}

// Context management
const observabilityContextKey = Symbol('observabilityContext')

export function getObservabilityContext(): ObservabilityContext | undefined {
  return (globalThis as any)[observabilityContextKey]
}

export function setObservabilityContext(context: ObservabilityContext | undefined): void {
  (globalThis as any)[observabilityContextKey] = context
}

// Higher-order functions for observability
export interface TracingOptions {
  name: string
  kind?: SpanKind
  attributes?: Record<string, unknown>
  processor?: SpanProcessor
}


/**
 * Enhanced withTracing that properly handles sync and async effects
 */
export const withTracing = (options: TracingOptions) =>
  <Args extends any[], Return>(effect: Effect<Args, Return>): Effect<Args, Return> => {
    return async (...args: Args): Promise<Awaited<Return>> => {
      const parentContext = getObservabilityContext()
      const traceId = parentContext?.span?.traceId || crypto.randomUUID()

      const span: Span = {
        id: crypto.randomUUID(),
        name: options.name,
        kind: options.kind || SpanKind.INTERNAL,
        traceId,
        parentId: parentContext?.span?.id,
        startTime: Date.now(),
        status: SpanStatus.UNSET,
        attributes: {
          ...options.attributes,
          arguments: args
        },
        events: [],
        links: []
      }

      setObservabilityContext({
        span,
        metrics: parentContext?.metrics || new MetricCollector(),
        logger: parentContext?.logger || new Logger(async () => {}),
        baggage: new Map(parentContext?.baggage || [])
      })

      try {
        // Ensure we properly await the result
        const result = await ensurePromise(effect(...args))
        span.status = SpanStatus.OK
        span.endTime = Date.now()
        return result as Awaited<Return>
      } catch (error) {
        span.status = SpanStatus.ERROR
        span.endTime = Date.now()
        span.attributes.error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        if (parentContext?.span) {
          span.links.push({
            spanId: parentContext.span.id,
            traceId: parentContext.span.traceId
          })
        }

        await options.processor?.processSpan(span)
        setObservabilityContext(parentContext)
      }
    }
  }

/**
 * Enhanced withMetrics that properly handles sync and async effects
 */
export const withMetrics = (
  metrics: Record<string, {
    type: MetricType
    labels?: Record<string, string>
    description?: string
  }>
) => <Args extends unknown[], Return>(effect: Effect<Args, Return>): Effect<Args, Return> => {
  return async (...args: Args): Promise<Return> => {
    const context = getObservabilityContext()
    const startTime = Date.now()

    try {
      const result = await ensurePromise(effect(...args))
      const duration = Date.now() - startTime

      Object.entries(metrics).forEach(([name, config]) => {
        if (!context?.metrics) return

        switch (config.type) {
          case MetricType.COUNTER:
            context.metrics.counter(name, 1, config.labels)
            break
          case MetricType.HISTOGRAM:
            context.metrics.histogram(`${name}_duration`, duration, config.labels)
            break
          case MetricType.GAUGE:
            context.metrics.gauge(name, 1, config.labels)
            break
        }
      })

      return result as Return
    } catch (error) {
      Object.entries(metrics).forEach(([name, config]) => {
        context?.metrics.counter(`${name}_errors`, 1, {
          ...config.labels,
          error: error instanceof Error ? error.message : String(error)
        })
      })
      throw error
    }
  }
}

/**
 * Enhanced withLogging that properly handles sync and async effects
 */
export const withLogging = (options: {
  level?: LogLevel
  context?: Record<string, unknown>
}) => <Args extends any[], Return>(effect: Effect<Args, Return>): AsyncEffect<Args, Return> => {
  return async (...args: Args): Promise<UnwrapPromise<Return>> => {
    const observabilityContext = getObservabilityContext()
    const level = options.level || LogLevel.INFO

    observabilityContext?.logger.log(level, `Starting ${observabilityContext.span?.name}`, {
      arguments: args,
      ...options.context
    })

    try {
      const result = await ensurePromise(effect(...args))
      observabilityContext?.logger.log(level, `Completed ${observabilityContext.span?.name}`, {
        duration: Date.now() - (observabilityContext.span?.startTime || 0),
        ...options.context
      })
      return result as UnwrapPromise<Return>
    } catch (error) {
      observabilityContext?.logger.error(`Failed ${observabilityContext.span?.name}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        ...options.context
      })
      throw error
    }
  }
}

/**
 * Enhanced withObservability that properly handles sync and async effects
 */
export const withObservability = (options: {
  name: string
  kind?: SpanKind
  metrics?: Record<string, {
    type: MetricType
    labels?: Record<string, string>
    description?: string
  }>
  logging?: {
    level?: LogLevel
    context?: Record<string, unknown>
  }
  processor?: SpanProcessor
}) => <Args extends any[], Return extends any>(effect: Effect<Args, Return>): AsyncEffect<Args, Return> => {
  const asyncEffect = asAsync(effect) as AsyncEffect<Args, Return>
  return asyncFlow(
    withTracing({ name: options.name, kind: options.kind, processor: options.processor }),
    options.metrics ? withMetrics(options.metrics) : identity,
    options.logging ? withLogging(options.logging) : identity,
  )(asyncEffect)
}

function flow<Args extends any[], Return>(
  ...fns: Array<(effect: Effect<Args, Return>) => Effect<Args, Return>>
): (effect: Effect<Args, Return>) => Effect<Args, Return> {
  return (effect: Effect<Args, Return>): Effect<Args, Return> => {
    return fns.reduce((acc, fn) => fn(acc), effect)
  }
}
function asAsync<Args extends any[], Return>(effect: Effect<Args, Return>): AsyncEffect<Args, Return> {
  return async (...args: Args): Promise<UnwrapPromise<Return>> => {
    return await ensurePromise(effect(...args)) as UnwrapPromise<Return>
  }
}
function ensurePromise<T>(value: T | Promise<T>): Promise<T> {
  if (value instanceof Promise) {
    return value;
  }
  return Promise.resolve(value);
}

export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T

export type AsyncEffect<in Args extends any[] = any[], out Return = any> =
  (...args: Args) => Promise<UnwrapPromise<Return>>

export function asyncFlow<Args extends any[], Return>(
  ...fns: Array<(effect: AsyncEffect<Args, Return>) => AsyncEffect<Args, Return>>
): (effect: AsyncEffect<Args, Return>) => AsyncEffect<Args, Return> {
  return (effect: AsyncEffect<Args, Return>): AsyncEffect<Args, Return> => {
    return fns.reduce((acc, fn) => fn(acc), effect);
  }
}
