// Type utilities for handling promises and results
type Awaited<T> = T extends Promise<infer U> ? U : T
export type MaybePromise<T> = T | Promise<T>
export type UnwrapPromise<T> = T extends Promise<infer U> ? U : T

/**
 * Ensures the return type is always a Promise
 */
export type AsyncEffect<Args extends any[] = any[], Return = any> =
  (...args: Args) => Promise<UnwrapPromise<Return>>

/**
 * Helper to ensure an effect's result is a promise
 */
export function ensurePromise<T>(value: MaybePromise<T>): Promise<T> {
  return value instanceof Promise ? value : Promise.resolve(value)
}

/**
 * Convert any effect to an async effect
 */
export function asAsync<Args extends any[], Return>(
  effect: Effect<Args, Return>
): AsyncEffect<Args, Return> {
  return async (...args: Args): Promise<UnwrapPromise<Return>> => ensurePromise(effect(...args) as MaybePromise<UnwrapPromise<Return>>)
}
/**
 * Generic type for both effects and handlers
 */
export type Effect<in out Args extends any[] = any[], in out Return = any> = 
  (...args: Args) => MaybePromise<Return>

/**
 * Generic type for functions that enhance effects/handlers
 */
export type Enhancer<E extends Effect> = 
  (effect: E) => E

/**
 * Compose multiple enhancers right-to-left
 */
export function compose<E extends Effect>(...enhancers: Enhancer<E>[]): Enhancer<E> {
  return (effect: E) => 
    enhancers.reduceRight((enhanced, enhance) => enhance(enhanced), effect)
}

/**
 * Compose multiple enhancers left-to-right
 */
export function flow<E extends Effect>(...enhancers: Enhancer<E>[]): Enhancer<E> {
  return (effect: E) => 
    enhancers.reduce((enhanced, enhance) => enhance(enhanced), effect)
}

/**
 * Apply an enhancer to an effect/handler
 */
export function enhance<E extends Effect>(
  effect: E,
  enhancer: Enhancer<E>
): E {
  return enhancer(effect)
}

/**
 * Apply multiple enhancers to an effect/handler left-to-right
 */
export function pipe<E extends Effect>(
  effect: E,
  ...enhancers: Enhancer<E>[]
): E {
  return flow(...enhancers)(effect)
}

/**
 * Combine multiple effects/handlers into one that runs them in sequence
 */
export function sequence<E extends Effect>(...effects: E[]): E {
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    let result: any
    for (const effect of effects) {
      result = await effect(...args)
    }
    return result
  }) as E
}

/**
 * Combine multiple effects/handlers into one that runs them in parallel
 */
export function parallel<E extends Effect>(...effects: E[]): E {
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    const results = await Promise.all(effects.map(e => e(...args)))
    return results[results.length - 1]
  }) as E
}

/**
 * Type-safe builder pattern for combining enhancers and effects/handlers
 */
export class EffectBuilder<E extends Effect> {
  private enhancers: Enhancer<E>[] = []

  enhance(enhancer: Enhancer<E>): this {
    this.enhancers.push(enhancer)
    return this
  }

  build(effect: E): E {
    return pipe(effect, ...this.enhancers)
  }
}

// Example usage with both effects and handlers:
/*
// With effects
const baseEffect = defineEffect('operation')
const enhancedEffect = flow(
  withTimeout(5000),
  withRetry({ attempts: 3, delay: 1000 })
)(baseEffect)

// With handlers
const baseHandler = (data: string) => Promise.resolve(data)
const enhancedHandler = flow(
  withTimeout(5000),
  withRetry({ attempts: 3, delay: 1000 })
)(baseHandler)

// Combining both
const combinedOperation = sequence(
  validationEffect,
  transformHandler,
  saveEffect
)

// Reusable enhancer combinations
const withResilience = flow(
  withTimeout(5000),
  withRetry({ attempts: 3, delay: 1000 })
)

// Works with both:
const resilientEffect = withResilience(baseEffect)
const resilientHandler = withResilience(baseHandler)
*/