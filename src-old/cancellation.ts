// cancellation.ts
import { defineEffect } from './createEffect'
import type { Effect } from './createEffect'

type MaybePromise <T> = Promise<T> | T

export class CancellationToken {
  private cancelled = false
  private callbacks = new Set<() => void>()

  constructor(private parent?: CancellationToken) {}

  get isCancelled(): boolean {
    return this.cancelled || this.parent?.isCancelled || false
  }

  onCancel(callback: () => void): () => void {
    this.callbacks.add(callback)
    return () => this.callbacks.delete(callback)
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.callbacks.forEach(cb => cb())
  }

  child(): CancellationToken {
    return new CancellationToken(this)
  }
}

// Main effect for getting the current token
export const getCancellationToken = defineEffect<() => CancellationToken>('getCancellationToken')

// Effect enhancer that adds cancellation
export const withCancellation = (token: CancellationToken) =>
  <E extends Effect>(effect: E): E => {
    return (async (...args: Parameters<E>) => {
      if (token.isCancelled) {
        throw new Error('Operation cancelled')
      }

      const cleanup = new Set<() => MaybePromise<void>>()

      // Allow registration of cleanup handlers
      const withCleanup = (fn: () => MaybePromise<void>) => {
        cleanup.add(fn)
        return () => cleanup.delete(fn)
      }

      const cancel = token.onCancel(async () => {
        for (const fn of cleanup) {
          await fn()
        }
      })

      try {
        return await effect(...args)
      } finally {
        cancel()
        if (token.isCancelled) {
          for (const fn of cleanup) {
            await fn()
          }
        }
      }
    }) as E
  }

// Helper to run with timeout and cancellation
export async function withTimeout<T>(
  operation: () => Promise<T>,
  timeout: number
): Promise<T> {
  const token = new CancellationToken()

  const timeoutId = setTimeout(() => token.cancel(), timeout)

  try {
    return await operation()
  } finally {
    clearTimeout(timeoutId)
  }
}

// Example usage:
/*
const token = new CancellationToken()

const cancellableEffect = pipe(
  baseEffect,
  withCancellation(token)
)

// Register cleanup
const cleanup = withCleanup(() => {
  // Cleanup resources
})

// Cancel after 5s
setTimeout(() => token.cancel(), 5000)

try {
  await cancellableEffect()
} catch (e) {
  if (token.isCancelled) {
    console.log('Operation was cancelled')
  }
}
*/
