import { getEffectContext } from "./context"

/**
 * Generic function type used for effects and handlers
 */
type AnyFunction = (...args: any[]) => any

/**
 * Priority levels for effect handlers
 */
export type Priority = number | 'high' | 'medium' | 'low'

/**
 * Type for effect handlers
 */
export type EffectHandler<T extends (...args: any[]) => any = AnyFunction> = T

/**
 * Create a new effect
 */
export function defineEffect<H extends EffectHandler>(
  name: string, 
  defaultHandler?: H
): H {
  const effect = ((...args: Parameters<H>): ReturnType<H> => {
    try {
      const ctx = getEffectContext()
      if (!ctx) {
        throw new Error(`No context provided when defining effect ${name}`)
      }

      const handler = ctx.handlers[name] as undefined | H
      if (handler && typeof handler === 'function') {
        return handler(...args)
      }

      if (defaultHandler && typeof defaultHandler === 'function') {
        return defaultHandler(...args)
      }

      throw new Error(`No effect handler found for: ${name}`)
    } catch (error) {
      throw error
    }
  }) as H

  return effect
}

/**
 * Convert Priority to numeric value
 */
export const getPriorityValue = (p: Priority): number => {
  if (typeof p === 'number') return p
  return { high: 2, medium: 1, low: 0 }[p]
}

/**
 * Define an effect handler
 */
export function defineHandler<H extends EffectHandler>(
  name: string,
  handler: H,
  priority: Priority = 'medium'
) {
  const ctx = getEffectContext()
  if (!ctx) {
    throw new Error(`No context provided when defining handler for effect ${name}`)
  }

  if (!handler || typeof handler !== 'function') {
    throw new Error(`The handler provided for ${name} is not of the correct type`)
  }

  if (name === 'then') {
    ctx.handlers[name] = handler
    return
  }

  ctx.handlers[name] = ((...args: Parameters<H>) => {
    return ctx.runtime.scheduler.schedule(
      () => handler(...args),
      { priority: getPriorityValue(priority) }
    )
  }) as H
}



/**
 * Effect composition utilities
 */

export function composeEffects<TArgs extends unknown[], TResult>(
  effects: Array<(...args: TArgs) => Promise<TResult>>,
  operation: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    let result = await operation(...args)
    
    for (const effect of effects) {
      result = await effect(...args)
    }
    
    return result
  }
}

export function composeEffectsParallel<TArgs extends unknown[], TResult>(
  effects: Array<(...args: TArgs) => Promise<void>>,
  operation: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const effectPromises = effects.map(effect => effect(...args))
    const operationPromise = operation(...args)
    
    await Promise.all(effectPromises)
    return operationPromise
  }
}

