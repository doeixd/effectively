// concurrency.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { contextRoot } from '../src/context'
import { 
 retry, 
 rateLimit, 
 backoff,
 withJitter,
 combinedEffect,
 setupConcurrencyHandlers 
} from '../src/concurrency.ts'


describe('Concurrency Primitives', () => {

 beforeEach(() => {
   vi.useFakeTimers()
 })

 describe('retry', () => {
   it('should retry failed operations up to maxAttempts', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()

       let attempts = 0
       const operation = async () => {
         attempts++
         if (attempts < 3) throw new Error('Failed')
         return 'success'
       }

       const result = await retry(operation, {
         maxAttempts: 3,
         backoff: backoff.constant(100)
       })

       expect(result).toBe('success')
       expect(attempts).toBe(3)
     })
   })

   it('should respect shouldRetry condition', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()

       let attempts = 0
       const operation = async () => {
         attempts++
         throw new Error('Wrong error')
       }

       await expect(retry(operation, {
         maxAttempts: 3,
         backoff: backoff.constant(100),
         shouldRetry: (error) => error.message === 'Right error'
       })).rejects.toThrow('Wrong error')

       expect(attempts).toBe(1) // Should not retry
     })
   })

   it('should use different backoff strategies', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()
       
       const delays: number[] = []
       // @ts-expect-error
       vi.spyOn(global, 'setTimeout').mockImplementation((cb: any, delay: number) => {
         delays.push(delay)
         cb()
         return undefined as any
       })

       let attempts = 0
       const operation = async () => {
         attempts++
         if (attempts < 3) throw new Error('Failed')
         return 'success'
       }

       // Test exponential backoff
       await retry(operation, {
         maxAttempts: 3,
         backoff: backoff.exponential(100)
       })

       expect(delays).toEqual([100, 200]) // 100 * 2^0, 100 * 2^1
     })
   })
 })

 describe('rateLimit', () => {
   it('should limit request rate', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()

       const timestamps: number[] = []
       const operation = async () => {
         timestamps.push(Date.now())
         return 'success'
       }

       const promises = Array(5).fill(0).map(() => 
         rateLimit(operation, {
           maxRequests: 2,
           timeWindow: 1000
         })
       )

       await Promise.all(promises)

       // Check time differences between requests
       const differences = timestamps.slice(1).map((t, i) => 
         t - timestamps[i]
       )

       // Should have delays close to timeWindow
       differences.forEach(diff => {
         expect(diff).toBeGreaterThanOrEqual(900)
       })
     })
   })

   it('should maintain fairness when configured', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()

       const order: number[] = []
       const operations = Array(5).fill(0).map((_, i) => 
         async () => { order.push(i); return i }
       )

       await Promise.all(operations.map(op => 
         rateLimit(op, {
           maxRequests: 1,
           timeWindow: 100,
           fairness: true
         })
       ))

       // Should maintain FIFO order
       expect(order).toEqual([0, 1, 2, 3, 4])
     })
   })
 })

 describe('backoff strategies', () => {
   it('should implement constant backoff', () => {
     const strategy = backoff.constant(100)
     expect(strategy.delay(1)).toBe(100)
     expect(strategy.delay(2)).toBe(100)
   })

   it('should implement linear backoff', () => {
     const strategy = backoff.linear(100)
     expect(strategy.delay(1)).toBe(100)
     expect(strategy.delay(2)).toBe(200)
     expect(strategy.delay(3)).toBe(300)
   })

   it('should implement exponential backoff', () => {
     const strategy = backoff.exponential(100)
     expect(strategy.delay(1)).toBe(100)
     expect(strategy.delay(2)).toBe(200)
     expect(strategy.delay(3)).toBe(400)
   })

   it('should implement fibonacci backoff', () => {
     const strategy = backoff.fibonacci(100)
     const delays = [1, 2, 3, 4].map(n => strategy.delay(n))
     expect(delays).toEqual([200, 300, 500, 800])
   })

   it('should add jitter to strategies', () => {
     const base = backoff.constant(100)
     const withJit = withJitter(base)
     
     // Run multiple times to test randomness
     const delays = Array(100).fill(0).map(() => withJit.delay(1))
     
     // Should be between 50-150 (0.5-1.5 * 100)
     delays.forEach(delay => {
       expect(delay).toBeGreaterThanOrEqual(50)
       expect(delay).toBeLessThanOrEqual(150)
     })
   })
 })

 describe('combinedEffect', () => {
   it('should compose multiple effects', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()

       const operations: string[] = []
       
       const result = await combinedEffect([
         op => retry(op, { maxAttempts: 2 }),
         op => rateLimit(op, { maxRequests: 1, timeWindow: 100 })
       ], async () => {
         operations.push('main')
         return 'success'
       })

       expect(result).toBe('success')
       expect(operations).toEqual(['main'])
     })
   })

   it('should maintain effect order', async () => {
     await contextRoot(async () => {
       setupConcurrencyHandlers()

       const order: string[] = []
       
       const effect1 = (op: () => Promise<any>) => {
         order.push('effect1 before')
         return op().then(result => {
           order.push('effect1 after')
           return result
         })
       }

       const effect2 = (op: () => Promise<any>) => {
         order.push('effect2 before')
         return op().then(result => {
           order.push('effect2 after')
           return result
         })
       }

       await combinedEffect(
         [effect1, effect2],
         async () => {
           order.push('operation')
           return 'success'
         }
       )

       expect(order).toEqual([
         'effect1 before',
         'effect2 before', 
         'operation',
         'effect2 after',
         'effect1 after'
       ])
     })
   })
 })
})