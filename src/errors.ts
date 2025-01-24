import { defineEffect, defineHandler } from './createEffect'
import { getEffectContext } from './context'

// Enhanced error handler type
export type ErrorHandler<E extends Error> = (
  error: E,
  options?: ErrorHandlingOptions
) => Promise<void> | void

export type ErrorHandlerMap = Map<Function, ErrorHandler<any>>

// Add error handlers to runtime context
// declare module './context' {
//   interface EffectRuntimeContext {
//     // errorHandlers: ErrorHandlerMap
//     currentErrorBoundary?: ErrorBoundary
//   }
// }

// Error handling options
export interface ErrorHandlingOptions {
  retry?: boolean
  maxRetries?: number
  recover?: boolean
  rethrow?: boolean
}

// Error boundary for scoping error handling
export class ErrorBoundary {
  private handlers = new Map<Function, ErrorHandler<any>>()
  private parent?: ErrorBoundary

  constructor(parent?: ErrorBoundary) {
    this.parent = parent
  }

  register<E extends Error>(
    errorType: new (...args: any[]) => E,
    handler: ErrorHandler<E>
  ) {
    this.handlers.set(errorType, handler)
  }

  async handle(error: Error, options?: ErrorHandlingOptions): Promise<void> {
    // Find most specific handler in current boundary
    let currentProto = Object.getPrototypeOf(error)
    while (currentProto !== Object.prototype) {
      const handler = this.handlers.get(currentProto.constructor)
      if (handler) {
        await handler(error, options)
        if (!options?.rethrow) {
          return
        }
      }
      currentProto = Object.getPrototypeOf(currentProto)
    }

    // If no handler found and we have a parent, try parent boundary
    if (this.parent) {
      await this.parent.handle(error, options)
      return
    }

    // No handler found in any boundary
    throw error
  }
}

// Helper to register error handlers in current boundary
export function registerErrorHandler<E extends Error>(
  errorType: new (...args: any[]) => E,
  handler: ErrorHandler<E>
) {
  const ctx = getEffectContext()
  const boundary = ctx.runtime.currentErrorBoundary

  if (!boundary) {
    throw new Error('No error boundary found in current context')
  }

  boundary.register(errorType, handler)
}


/**
 * Creates a new error boundary for the duration of the provided function.
 * The new boundary inherits from any existing parent boundary in the current context.
 *
 * @template T The return type of the provided function
 * @param fn Function to execute within the new error boundary
 * @returns Promise resolving to the function's return value
 */
export async function createErrorBoundary<T>(
  fn: () => T | Promise<T>
): Promise<T> {
  const ctx = getEffectContext()
  const parentBoundary = ctx.runtime.currentErrorBoundary
  const newBoundary = new ErrorBoundary(parentBoundary)

  // Set new boundary as current
  ctx.runtime.currentErrorBoundary = newBoundary

  try {
    // Handle both sync and async functions
    return await Promise.resolve(fn())
  } finally {
    // Restore parent boundary
    ctx.runtime.currentErrorBoundary = parentBoundary
  }
}


// Example usage:
/*
await createErrorBoundary(async () => {
  // Register handlers for this boundary
  registerErrorHandler(ValidationError, async (error) => {
    console.log('Validation failed:', error.message)
  })

  registerErrorHandler(DatabaseError, async (error, options) => {
    if (options?.retry && options.maxRetries) {
      // Implement retry logic
    }
    console.error('Database error:', error.message)
  })

  try {
    await riskyOperation()
  } catch (error) {
    if (error instanceof Error) {
      // Will be handled by appropriate handler in current boundary
      // or parent boundaries
      await handleError(error, { retry: true, maxRetries: 3 })
    }
  }
})

// Nested boundaries
await createErrorBoundary(async () => {
  registerErrorHandler(NetworkError, async (error) => {
    // Handle network errors
  })

  await createErrorBoundary(async () => {
    registerErrorHandler(ValidationError, async (error) => {
      // This handler takes precedence over parent handlers
      // for ValidationErrors in this scope
    })

    await someOperation()
  })
})
*/
