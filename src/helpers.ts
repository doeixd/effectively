/**
 * Generic type for both effects and handlers
 */
export type Effect<Args extends any[] = any[], Return = any> = 
  (...args: Args) => Return

// Core error handling and retries
export const withRetry = (options: {
  attempts: number
  delay: number
  shouldRetry?: (error: Error, attempt: number) => boolean | Promise<boolean>
}) => <E extends Effect>(effect: E): E => {
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    let lastError: Error | undefined
    
    for (let attempt = 1; attempt <= options.attempts; attempt++) {
      try {
        return await effect(...args)
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        if (attempt < options.attempts) {
          if (options.shouldRetry && !(await options.shouldRetry(lastError, attempt))) {
            break
          }
          await new Promise(resolve => setTimeout(resolve, options.delay))
        }
      }
    }
    
    throw lastError
  }) as E
}

export const withTimeout = (timeout: number) => 
  <E extends Effect>(effect: E): E => {
    return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
      let timeoutId: NodeJS.Timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Operation timeout')), timeout)
      })
      
      try {
        return await Promise.race([
          effect(...args),
          timeoutPromise
        ])
      } finally {
        clearTimeout(timeoutId!)
      }
    }) as E
  }

// Validation and transformation
export const withValidation = <E extends Effect>(
  validate: (...args: Parameters<E>) => boolean | Promise<boolean>,
  errorMessage?: string
) => (effect: E): E => {
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    const isValid = await validate(...args)
    if (!isValid) {
      throw new Error(errorMessage || 'Validation failed')
    }
    return effect(...args)
  }) as E
}

export const withTransform = <E extends Effect>(
  transform: (...args: Parameters<E>) => Parameters<E> | Promise<Parameters<E>>
) => (effect: E): E => {
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    const transformedArgs = await transform(...args)
    return effect(...transformedArgs)
  }) as E
}

// Caching and memoization
export const withCache = <E extends Effect>(options: {
  ttl: number
  maxSize?: number
  keyFn?: (...args: Parameters<E>) => string
}) => (effect: E): E => {
  const cache = new Map<string, { value: ReturnType<E>, timestamp: number }>()
  const keyFn = options.keyFn || ((...args) => JSON.stringify(args))
  
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    const key = keyFn(...args)
    const now = Date.now()
    const cached = cache.get(key)
    
    if (cached && now - cached.timestamp < options.ttl) {
      return cached.value
    }
    
    const result = await effect(...args)
    cache.set(key, { value: result, timestamp: now })
    
    if (options.maxSize && cache.size > options.maxSize) {
      const oldestKey = Array.from(cache.entries())
        .sort(([, a], [, b]) => a.timestamp - b.timestamp)[0][0]
      cache.delete(oldestKey)
    }
    
    return result
  }) as E
}

// Rate limiting
export const withRateLimit = (options: {
  maxCalls: number
  window: number
}) => <E extends Effect>(effect: E): E => {
  const calls: number[] = []
  
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    const now = Date.now()
    calls.push(now)
    
    // Remove old calls outside the window
    while (calls.length && calls[0] < now - options.window) {
      calls.shift()
    }
    
    if (calls.length > options.maxCalls) {
      throw new Error('Rate limit exceeded')
    }
    
    return effect(...args)
  }) as E
}

// Debounce
export const withDebounce = (wait: number) => 
  <E extends Effect>(effect: E): E => {
    let timeout: NodeJS.Timeout
    let pendingPromise: Promise<ReturnType<E>> | null = null
    
    return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
      if (pendingPromise) return pendingPromise
      
      pendingPromise = new Promise((resolve, reject) => {
        clearTimeout(timeout)
        timeout = setTimeout(async () => {
          try {
            const result = await effect(...args)
            pendingPromise = null
            resolve(result)
          } catch (error) {
            pendingPromise = null
            reject(error)
          }
        }, wait)
      })
      
      return pendingPromise
    }) as E
  }

// Circuit breaker
export const withCircuitBreaker = (options: {
  threshold: number
  resetTimeout: number
}) => <E extends Effect>(effect: E): E => {
  let failures = 0
  let lastFailure: number | null = null
  let isOpen = false
  
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    if (isOpen) {
      if (lastFailure && Date.now() - lastFailure > options.resetTimeout) {
        isOpen = false
        failures = 0
      } else {
        throw new Error('Circuit breaker is open')
      }
    }
    
    try {
      const result = await effect(...args)
      failures = 0
      return result
    } catch (error) {
      failures++
      lastFailure = Date.now()
      
      if (failures >= options.threshold) {
        isOpen = true
      }
      throw error
    }
  }) as E
}

// Metrics
export const withMetrics = <E extends Effect>(
  callback: (metrics: {
    duration: number
    success: boolean
    args: Parameters<E>
    result?: ReturnType<E>
    error?: Error
  }) => void
) => (effect: E): E => {
  return (async (...args: Parameters<E>): Promise<ReturnType<E>> => {
    const start = Date.now()
    try {
      const result = await effect(...args)
      callback({
        duration: Date.now() - start,
        success: true,
        args,
        result
      })
      return result
    } catch (error) {
      callback({
        duration: Date.now() - start,
        success: false,
        args,
        error: error instanceof Error ? error : new Error(String(error))
      })
      throw error
    }
  }) as E
}

// Example usage:
/*
// Works with both effects and handlers:
const baseEffect = defineEffect('operation')
const baseHandler = async (data: string) => data

const enhance = flow(
  withTimeout(5000),
  withRetry({ attempts: 3, delay: 1000 }),
  withCache({ ttl: 60000 }),
  withCircuitBreaker({ threshold: 5, resetTimeout: 30000 })
)

// Same enhancement works for both:
const enhancedEffect = enhance(baseEffect)
const enhancedHandler = enhance(baseHandler)
*/