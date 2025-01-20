// errorHandling.ts
import { defineEffect, defineHandler } from './createEffect'
import { getEffectContext } from './context'

// Type definitions for our error handling system
export type ErrorHandler<E extends Error> = (error: E) => Promise<void> | void
export type ErrorHandlerMap = Map<Function, ErrorHandler<any>>

// Extend the runtime context to include error handlers
declare module './context' {
  interface EffectRuntimeContext {
    errorHandlers: ErrorHandlerMap
  }
}

// Effect for handling errors
export type ErrorHandler2 = <E extends Error>(error: E) => Promise<void> | void
export const handleError = defineEffect<ErrorHandler2>('handleError')

// Helper to register error handlers
export function registerErrorHandler<E extends Error>(
  errorType: new (...args: any[]) => E,
  handler: ErrorHandler<E>
) {
  const ctx = getEffectContext()
  if (!ctx.runtime.errorHandlers) {
    ctx.runtime.errorHandlers = new Map()
  }
  ctx.runtime.errorHandlers.set(errorType, handler)
}

// Default error handler setup
defineHandler('handleError', async (error: Error) => {
  const ctx = getEffectContext()
  const handlers = ctx.runtime.errorHandlers

  // Find the most specific handler for this error type
  let currentProto = Object.getPrototypeOf(error)
  while (currentProto !== Object.prototype) {
    const handler = handlers.get(currentProto.constructor)
    if (handler) {
      return handler(error)
    }
    currentProto = Object.getPrototypeOf(currentProto)
  }

  // Default handler if no specific handler found
  console.error('Unhandled error:', error)
  throw error
})

// Example custom error types
export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DatabaseError'
  }
}