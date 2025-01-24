// concurrency.ts
import { defineEffect, defineHandler } from './createEffect'
import { getEffectContext } from './context'

// Types for concurrency control
export interface RetryOptions {
  maxAttempts?: number
  backoff?: BackoffStrategy
  shouldRetry?: (error: Error) => boolean
}

export interface BackoffStrategy {
  delay: (attempt: number) => number
  maxDelay?: number
  jitter?: boolean
}

// Backoff strategies
export const backoff = {
  constant: (delay: number): BackoffStrategy => ({
    delay: () => delay
  }),

  linear: (initialDelay: number): BackoffStrategy => ({
    delay: (attempt) => initialDelay * attempt
  }),

  exponential: (initialDelay: number): BackoffStrategy => ({
    delay: (attempt) => initialDelay * Math.pow(2, attempt - 1)
  }),

  fibonacci: (initialDelay: number): BackoffStrategy => {
    let prev = initialDelay
    let curr = initialDelay
    return {
      delay: () => {
        const next = prev + curr
        prev = curr
        curr = next
        return next
      }
    }
  }
}

// Add jitter to any backoff strategy
export const withJitter = (strategy: BackoffStrategy): BackoffStrategy => ({
  ...strategy,
  delay: (attempt: number) => {
    const delay = strategy.delay(attempt)
    return delay * (0.5 + Math.random())
  }
})

// Main retry effect

type RetryFn = <T>(operation: () => Promise<T>, options?: RetryOptions) => Promise<T>
export const retry = defineEffect<RetryFn>('retry')

// Rate limiting effect
export interface RateLimitOptions {
  maxRequests: number
  timeWindow: number // in milliseconds
  fairness?: boolean // if true, maintains FIFO order
}

type RateLimitFn = <T>(operation: () => Promise<T>, options?: RateLimitOptions) => Promise<T>
export const rateLimit = defineEffect<RateLimitFn>('rateLimit')

// Semaphore for concurrency limiting
class Semaphore {
  private permits: number
  private queue: Array<() => void> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }

    return new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.permits++
    }
  }
}

// Rate limiter implementation
class RateLimiter {
  private timestamps: number[] = []
  private semaphore: Semaphore
  private readonly maxRequests: number
  private readonly timeWindow: number
  private readonly fairness: boolean

  constructor(options: RateLimitOptions) {
    this.maxRequests = options.maxRequests
    this.timeWindow = options.timeWindow
    this.fairness = options.fairness ?? true
    this.semaphore = new Semaphore(this.maxRequests)
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    await this.semaphore.acquire()

    try {
      // Clean up old timestamps
      const now = Date.now()
      this.timestamps = this.timestamps.filter(
        ts => now - ts < this.timeWindow
      )

      // Check if we can proceed
      if (this.timestamps.length >= this.maxRequests) {
        const oldestTimestamp = this.timestamps[0]
        const waitTime = this.timeWindow - (now - oldestTimestamp)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      }

      // Execute operation
      const result = await operation()
      this.timestamps.push(Date.now())
      return result
    } finally {
      this.semaphore.release()
    }
  }
}

// Set up handlers
export function setupConcurrencyHandlers() {
  const rateLimiters = new Map<string, RateLimiter>()

  defineHandler('retry', async (operation, options: RetryOptions = {}) => {
    const {
      maxAttempts = 3,
      // @ts-expect-error
      backoff = backoff.exponential(1000),
      shouldRetry = (error) => true
    } = options

    let attempt = 1
    let lastError: Error | undefined

    while (attempt <= maxAttempts) {
      try {
        return await operation()
      } catch (error) {
        if (error instanceof Error) {
          lastError = error

          if (!shouldRetry(error) || attempt === maxAttempts) {
            throw error
          }

          const delay = Math.min(
            backoff.delay(attempt),
            backoff.maxDelay ?? Infinity
          )

          await new Promise(resolve => setTimeout(resolve, delay))
          attempt++
        } else {
          throw error
        }
      }
    }

    throw lastError
  })

  defineHandler('rateLimit', async (operation, options: RateLimitOptions) => {
    const key = JSON.stringify(options)
    if (!rateLimiters.has(key)) {
      rateLimiters.set(key, new RateLimiter(options))
    }
    const limiter = rateLimiters.get(key)!
    return limiter.execute(operation)
  })
}


export type EffectOperator<T> = (operation: () => Promise<T>) => Promise<T>

export type CombinedEffectFn = <T>(
  operators: Array<EffectOperator<T>>,
  operation: () => Promise<T>
) => Promise<T>

export const combinedEffect = defineEffect<CombinedEffectFn>('combinedEffect', async <T>(
  operators: Array<EffectOperator<T>>,
  operation: () => Promise<T>
): Promise<T> => {
  // Execute the composed functions immediately rather than returning a function
  return operators.reduceRight(
    (composed, operator) => operator(() => composed),
    operation()
  )
})
