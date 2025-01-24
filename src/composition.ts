// composition.ts
import { type Effect, type EnhancedEffect } from './createEffect'


// Type helpers
type UnwrapPromise<T> = T extends Promise<infer U> ? U : T
type MaybePromise<T> = T | Promise<T>

// Enhanced effect type with metadata


// Type-safe enhancer
type Enhancer<E extends EnhancedEffect> = {
  (effect: E): E
  readonly name?: string
}

/**
 * Pipe an effect through a series of enhancers left-to-right
 */
export function pipe<E extends EnhancedEffect, A>(
  effect: E,
  f1: Enhancer<E>
): A extends E ? A : E

export function pipe<E extends EnhancedEffect, A extends EnhancedEffect, B>(
  effect: E,
  f1: Enhancer<E>,
  f2: Enhancer<A>
): B extends E ? B : E

export function pipe<E extends EnhancedEffect, A extends EnhancedEffect, B extends EnhancedEffect, C>(
  effect: E,
  f1: Enhancer<E>,
  f2: Enhancer<A>,
  f3: Enhancer<B>
): C extends E ? C : E

export function pipe<E extends EnhancedEffect>(
  effect: E,
  ...enhancers: Enhancer<E>[]
): E {
  const enhanced = enhancers.reduce((e, enhance) => enhance(e), effect)

  // Preserve metadata through composition
  enhanced.metadata = {
    enhancers: [
      ...(effect.metadata?.enhancers || []),
      ...enhancers.map(e => e.name || 'unknown')
    ]
  }

  return enhanced
}

/**
 * Compose enhancers right-to-left
 */
export function compose<E extends EnhancedEffect>(
  ...enhancers: Enhancer<E>[]
): Enhancer<E> {
  return (effect: E) => pipe(effect, ...enhancers.reverse())
}

/**
 * Run effects in sequence
 */
export function sequence<Args extends any[], Return>(
  ...effects: EnhancedEffect<Args, Return>[]
): EnhancedEffect<Args, Return> {
  return async (...args: Args): Promise<Return> => {
    let result: Return | undefined

    for (const effect of effects) {
      result = await effect(...args)
    }

    return result!
  }
}

/**
 * Run effects in parallel
 */
export function parallel<Args extends any[], Return>(
  ...effects: EnhancedEffect<Args, MaybePromise<Return>>[]
): EnhancedEffect<Args, Return[]> {
  return async (...args: Args): Promise<Return[]> => {
    const results = await Promise.all(
      effects.map(effect => effect(...args))
    )
    return results
  }
}

/**
 * Create a named enhancer
 */
export function createEnhancer<E extends EnhancedEffect>(
  name: string,
  enhance: (effect: E) => E
): Enhancer<E> {
  const enhancer: Enhancer<E> = (effect: E) => enhance(effect)
  enhancer.name = name
  return enhancer
}

/**
 * Transform effect arguments
 */
export function mapArgs<E extends EnhancedEffect, NewArgs extends any[]>(
  effect: E,
  transform: (...args: NewArgs) => Parameters<E>
): EnhancedEffect<NewArgs, ReturnType<E>> {
  return async (...args: NewArgs) => effect(...transform(...args))
}

/**
 * Transform effect result
 */
export function mapResult<E extends EnhancedEffect, NewReturn>(
  effect: E,
  transform: (result: ReturnType<E>) => MaybePromise<NewReturn>
): EnhancedEffect<Parameters<E>, NewReturn> {
  return async (...args: Parameters<E>) => transform(await effect(...args))
}

/**
 * Apply type-safe validation to effect arguments
 */
export function withValidation<E extends EnhancedEffect>(
  validate: (...args: Parameters<E>) => boolean | Promise<boolean>
): Enhancer<E> {
  return createEnhancer('validate', (effect) => {
    return async (...args: Parameters<E>) => {
      if (!await validate(...args)) {
        throw new Error('Validation failed')
      }
      return effect(...args)
    }
  })
}

/**
 * Handle errors from an effect
 */
export function withErrorHandler<E extends EnhancedEffect>(
  handler: (error: Error, ...args: Parameters<E>) => ReturnType<E> | Promise<ReturnType<E>>
): Enhancer<E> {
  return createEnhancer('errorHandler', (effect) => {
    return async (...args: Parameters<E>) => {
      try {
        return await effect(...args)
      } catch (error) {
        if (error instanceof Error) {
          return handler(error, ...args)
        }
        throw error
      }
    }
  })
}

// Example usage:
/*
const fetchUser = defineEffect<(id: string) => Promise<User>>('fetchUser')
const validateUser = defineEffect<(user: User) => Promise<boolean>>('validateUser')
const saveUser = defineEffect<(user: User) => Promise<void>>('saveUser')

// Compose complex operations
const processUser = pipe(
  fetchUser,
  withTimeout(5000),
  withRetry({ attempts: 3 }),
  mapResult(async user => ({
    ...user,
    processedAt: new Date()
  })),
  withValidation(user => user.id !== undefined),
  withErrorHandler(async (error, id) => {
    logger.error(`Failed to process user ${id}`, error)
    throw error
  })
)

// Run effects in sequence
const createUser = sequence(
  validateUser,
  processUser,
  saveUser
)

// Run effects in parallel
const [user, preferences] = await parallel(
  () => fetchUser(id),
  () => fetchPreferences(id)
)()
*/
