import { getEffectContext } from "./context"

/**
* Generic function type used for effects and handlers
*/
type AnyFunction = (...args: any[]) => any

/**
* Priority levels for effect handlers. Can be either:
* - Named priority: 'high' (2) | 'medium' (1) | 'low' (0)
* - Numeric priority: Any number (higher = higher priority)
* 
* @example
* ```ts
* defineHandler('log', console.log, 'high')
* defineHandler('metrics', sendMetrics, 2) // Same as 'high'
* ```
*/
export type Priority = number | 'high' | 'medium' | 'low'

/**
* Type for effect handlers. Extends AnyFunction to allow any function signature.
* 
* @typeParam T - Function signature the handler must match
*/
export type EffectHandler<T extends (...args: any[]) => any = AnyFunction> = T

/**
* Creates a new effect with an optional default handler.
* The created effect is a function that will look up and execute its handler when called.
* 
* @typeParam H - Function signature for the effect and its handlers
* @param name - Unique name to identify the effect
* @param defaultHandler - Optional fallback handler if no other handler is defined
* @returns A function matching the handler signature that will execute the effect
* 
* @example
* Simple logging effect:
* ```ts
* const log = defineEffect<(message: string) => void>('log')
* ```
* 
* @example
* Effect with default handler:
* ```ts
* const getTime = defineEffect(
*   'getTime',
*   () => new Date().toISOString()
* )
* ```
* 
* @example
* Complex effect with async handler:
* ```ts
* interface User {
*   id: number
*   name: string
* }
* 
* const saveUser = defineEffect<(user: User) => Promise<void>>('saveUser')
* 
* defineHandler('saveUser', async (user) => {
*   await db.users.save(user)
* }, 'high')
* 
* // Usage
* await saveUser({ id: 1, name: 'Alice' })
* ```
* 
* @throws {Error} When no context is available
* @throws {Error} When no handler is found and no default handler exists
*/
export function defineEffect <H extends EffectHandler>  (name: string, defaultHandler?: H) {
 return ((...args: Parameters<H>): ReturnType<H> => {

   try {
   var ctx = getEffectContext()
   } catch (e) {
    // @ts-expect-error
    ctx = undefined
   }

   if (!ctx) {
     throw new Error(`No context provided when defining effect ${name}`)
   }

   const handlers = ctx.handlers

   if (!handlers) {
     throw new Error(`No effect handler context found when running a handler for: ${name}`)
   }

   const handler = handlers?.[name] as undefined | H
   if (handler && typeof handler == 'function') {
     return handler()
   }

   if (!handler && defaultHandler && typeof defaultHandler == 'function') {
     return defaultHandler()
   }

   throw new Error(`No effect handler found for: ${name}`) 
 }) as H
}

/**
* Converts a Priority value to its numeric representation.
* 
* @param p - Priority value to convert
* @returns Numeric priority value where higher numbers = higher priority
* 
* @example
* ```ts
* getPriorityValue('high')   // Returns 2
* getPriorityValue('medium') // Returns 1
* getPriorityValue('low')    // Returns 0
* getPriorityValue(5)        // Returns 5
* ```
*/
export const getPriorityValue = (p: Priority): number => {
   if (typeof p === 'number') return p
   return { high: 2, medium: 1, low: 0 }[p]
}

/**
* Defines how an effect should be handled within the current context.
* Handlers are automatically wrapped with scheduling logic except for the special 'then' handler.
* 
* @typeParam H - Function signature the handler must implement
* @param name - Name of the effect to handle
* @param handler - Function to handle the effect
* @param priority - Priority level for handler execution
* 
* @example
* Simple synchronous handler:
* ```ts
* defineHandler('log', (message: string) => {
*   console.log(`[${new Date().toISOString()}] ${message}`)
* }, 'high')
* ```
* 
* @example
* Async handler with error handling:
* ```ts
* defineHandler('saveUser', async (user: User) => {
*   try {
*     await db.users.save(user)
*   } catch (error) {
*     await handleError(error)
*   }
* }, 'medium')
* ```
* 
* @example
* Handler with custom numeric priority:
* ```ts
* defineHandler('criticalOperation', async () => {
*   // Important stuff
* }, 10) // Very high priority
* ```
* 
* @throws {Error} When no context is available
* @throws {Error} When handler is invalid
*/
export function defineHandler <H extends EffectHandler>(
 name: string, 
 handler: H, 
 priority: Priority = 'medium'
) {
 const ctx = getEffectContext()
 if (!ctx) {
   throw new Error(`No context provided when defining handler for effect ${name}`)
 }

 const handlers = ctx.handlers

 if (!handlers) {
   throw new Error(`No effect handler context found when trying to create a handler for: ${name}`)
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
       getPriorityValue(priority)
   )
 }) as H
}


export function composeEffects<TArgs extends unknown[], TResult>(
  effects: ((...args: TArgs) => Promise<TResult>)[],
  operation: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    let currentResult = operation(...args)

    for (const effect of effects) {
      currentResult = effect(...args)
    }

    return currentResult
  }
}

export function composeEffectsParallel<TArgs extends unknown[], TResult>(
  effects: ((...args: TArgs) => Promise<void>)[],
  operation: (...args: TArgs) => Promise<TResult>
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs) => {
    const effectPromises = effects.map((effect) => effect(...args))
    const operationPromise = operation(...args)

    await Promise.all(effectPromises)
    return operationPromise
  }
}
