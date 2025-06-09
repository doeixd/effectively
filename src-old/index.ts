/**
* A lightweight, type-safe effect system for TypeScript inspired by algebraic effects.
*
* Features:
* - Type-safe effect definitions and handlers
* - Priority-based task scheduling
* - Sophisticated error handling
* - Built-in concurrency primitives
* - Composable effects
*
* @example
* ```ts
* import { defineEffect, defineHandler, contextRoot } from 'effectivly'
*
* // Define an effect
* const log = defineEffect<(msg: string) => void>('log')
*
* await contextRoot(async () => {
*   // Define the handler
*   defineHandler('log', (msg) => {
*     console.log(`[${new Date().toISOString()}] ${msg}`)
*   }, 'high')
*
*   // Use the effect
*   await log('Hello world!')
* })
* ```
*
* @packageDocumentation
*/

export {
 contextRoot,
 getEffectContext,
 createDefaultEffectContext,
 setupGlobalEffectContext,
 type EffectContext,
 type EffectHandlerContext,
 type EffectRuntimeContext
} from './context'

/**
* Create a new effect with optional default handler.
*
* @param name - Unique name for the effect
* @param defaultHandler - Optional default implementation
*
* @example
* ```ts
* // Simple effect
* const log = defineEffect<(msg: string) => void>('log')
*
* // Effect with default handler
* const getTime = defineEffect('getTime', () => new Date().toISOString())
*
* // Effect with complex types
* interface User {
*   id: number
*   name: string
* }
*
* const saveUser = defineEffect<(user: User) => Promise<void>>('saveUser')
* ```
*/
export {
 defineEffect,
 defineHandler,
 getPriorityValue,
 type Priority,
 type EffectHandler
} from './createEffect'

/**
* Concurrency primitives for retry logic and rate limiting.
*
* @example
* ```ts
* // Retry with exponential backoff
* const result = await retry(
*   async () => fetchData(),
*   {
*     maxAttempts: 3,
*     backoff: backoff.exponential(1000),
*     shouldRetry: (error) => error instanceof NetworkError
*   }
* )
*
* // Rate limiting
* const rateLimitedApi = await rateLimit(
*   async () => callApi(),
*   {
*     maxRequests: 100,
*     timeWindow: 60000, // 1 minute
*     fairness: true
*   }
* )
*
* // Combine effects
* const resilientApi = await combinedEffect(
*   [
*     (op) => retry(op, { maxAttempts: 3 }),
*     (op) => rateLimit(op, { maxRequests: 100, timeWindow: 60000 })
*   ],
*   async () => fetchApi()
* )
* ```
*/
export {
 retry,
 rateLimit,
 backoff,
 withJitter,
 combinedEffect,
 setupConcurrencyHandlers,
 type RetryOptions,
 type RateLimitOptions,
 type BackoffStrategy,
 type EffectOperator
} from './concurrency'

/**
* Error handling system with inheritance-based handler resolution.
*
* @example
* ```ts
* class ValidationError extends Error {}
* class DatabaseError extends Error {}
*
* await contextRoot(async () => {
*   // Register error handlers
*   registerErrorHandler(ValidationError, async (error) => {
*     console.log('Validation failed:', error.message)
*   })
*
*   registerErrorHandler(DatabaseError, async (error) => {
*     console.error('Database error:', error.message)
*     await notifyAdmin(error)
*   })
*
*   try {
*     await saveUser(user)
*   } catch (error) {
*     // Error has been handled by appropriate handler
*   }
* })
* ```
*/
export {
 registerErrorHandler,
 type ErrorHandler,
 type ErrorHandlerMap
} from './errors'

/**
* Priority-based task scheduler.
*
* @example
* ```ts
* const scheduler = createScheduler()
*
* // Schedule high priority task
* await scheduler.schedule(
*   async () => importantOperation(),
*   'high'
* )
*
* // Pause processing
* scheduler.pause()
*
* // Queue up some tasks while paused
* const tasks = [1, 2, 3].map(i =>
*   scheduler.schedule(
*     () => processItem(i),
*     'low'
*   )
* )
*
* // Resume processing
* scheduler.resume()
*
* // Wait for all tasks
* await Promise.all(tasks)
* ```
*/
export {
 createScheduler,
 schedule,
 type Task
} from './scheduler'

/**
* Continuation management for complex control flows.
*
* @example
* ```ts
* const getUser = Cont(next => userId => {
*   return then(next, fetchUser(userId))
* })
*
* const verifyUser = Cont(next => user => {
*   return then(next, validateUser(user))
* })
*
* const processUser = chain(
*   getUser,
*   verifyUser,
*   finalUser => `Processed ${finalUser.name}`
* )
* ```
*/
export {
 then,
 Cont,
 createContinuationQueue,
 type ContinuationFn,
 type QueuedContinuation,
 type ContinuationQueue
} from './then'
