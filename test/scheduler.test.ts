// scheduler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createScheduler, type Task } from '../src/scheduler'
import { contextRoot } from '../src/context'
import { handleError } from '../src/errors'

// Mock error handling
vi.mock('./errors', () => ({
 handleError: vi.fn()
}))

describe('PriorityQueue', () => {
 describe('Task Scheduling', () => {
   it('should execute tasks in priority order', async () => {
     const scheduler = createScheduler()
     const executed: number[] = []

     await Promise.all([
       scheduler.schedule(() => {
         executed.push(1)
         return 'low priority'
       }, 0),
       scheduler.schedule(() => {
         executed.push(2)
         return 'high priority'
       }, 2),
       scheduler.schedule(() => {
         executed.push(3)
         return 'medium priority'
       }, 1)
     ])

     expect(executed).toEqual([2, 3, 1])
   })

   it('should handle async tasks', async () => {
     const scheduler = createScheduler()
     const results: string[] = []

     await Promise.all([
       scheduler.schedule(async () => {
         await new Promise(r => setTimeout(r, 50))
         results.push('slow')
         return 'slow'
       }, 0),
       scheduler.schedule(async () => {
         await new Promise(r => setTimeout(r, 10))
         results.push('fast')
         return 'fast'
       }, 1)
     ])

     expect(results).toEqual(['fast', 'slow'])
   })

   it('should maintain FIFO order for equal priorities', async () => {
     const scheduler = createScheduler()
     const executed: number[] = []

     await Promise.all([
       scheduler.schedule(() => {
         executed.push(1)
         return 'first'
       }, 1),
       scheduler.schedule(() => {
         executed.push(2)
         return 'second'
       }, 1),
       scheduler.schedule(() => {
         executed.push(3)
         return 'third'
       }, 1)
     ])

     expect(executed).toEqual([1, 2, 3])
   })
 })

 describe('Pause and Resume', () => {
   it('should pause and resume task processing', async () => {
     const scheduler = createScheduler()
     const executed: number[] = []

     scheduler.schedule(() => {
       executed.push(1)
       return 'first'
     })

     scheduler.pause()

     scheduler.schedule(() => {
       executed.push(2)
       return 'second'
     })

     // Should not execute yet
     expect(executed).toEqual([1])

     scheduler.resume()

     // Wait for processing
     await new Promise(r => setTimeout(r, 0))

     expect(executed).toEqual([1, 2])
   })
 })

 describe('Error Handling', () => {
   it('should handle errors in tasks', async () => {
     const scheduler = createScheduler()
     const error = new Error('Test error')

     const promise = scheduler.schedule(() => {
       throw error
     })

     await expect(promise).rejects.toThrow(error)
     expect(handleError).toHaveBeenCalledWith(error)
   })

   it('should handle unknown errors', async () => {
     const scheduler = createScheduler()
     
     const promise = scheduler.schedule(() => {
       throw 'not an Error object'
     })

     await expect(promise).rejects.toThrow('Unknown error occurred')
     expect(handleError).toHaveBeenCalled()
   })

   it('should handle errors in async tasks', async () => {
     const scheduler = createScheduler()
     const error = new Error('Async error')

     const promise = scheduler.schedule(async () => {
       await new Promise(r => setTimeout(r, 10))
       throw error
     })

     await expect(promise).rejects.toThrow(error)
     expect(handleError).toHaveBeenCalledWith(error)
   })

   it('should handle errors in error handling', async () => {
     const scheduler = createScheduler()
     const originalError = new Error('Original error')
     const handlingError = new Error('Error handling failed')

     vi.mocked(handleError).mockRejectedValueOnce(handlingError)

     const promise = scheduler.schedule(() => {
       throw originalError
     })

     await expect(promise).rejects.toThrow(handlingError)
   })
 })

 describe('Concurrent Processing', () => {
   it('should not process new tasks while processing', async () => {
     const scheduler = createScheduler()
     const executionOrder: string[] = []

     const longTask = scheduler.schedule(async () => {
       executionOrder.push('start long')
       await new Promise(r => setTimeout(r, 50))
       executionOrder.push('end long')
       return 'long'
     })

     const quickTask = scheduler.schedule(async () => {
       executionOrder.push('quick')
       return 'quick'
     })

     await Promise.all([longTask, quickTask])

     expect(executionOrder).toEqual(['start long', 'end long', 'quick'])
   })

   it('should handle multiple concurrent schedules', async () => {
     const scheduler = createScheduler()
     const results: number[] = []

     await Promise.all(
       Array.from({ length: 100 }, (_, i) => 
         scheduler.schedule(() => {
           results.push(i)
           return i
         }, Math.random() * 10)
       )
     )

     expect(results).toHaveLength(100)
     // Results should be ordered by priority (which was random)
     expect(results).not.toEqual([...Array(100).keys()])
   })
 })

 describe('Edge Cases', () => {
   it('should handle empty queue', async () => {
     const scheduler = createScheduler()
     await scheduler.process()
     expect(true).toBe(true) // Should not throw
   })

   it('should handle rapid pause/resume cycles', async () => {
     const scheduler = createScheduler()
     const executed: number[] = []

     const task = scheduler.schedule(() => {
       executed.push(1)
       return 'done'
     })

     for (let i = 0; i < 100; i++) {
       scheduler.pause()
       scheduler.resume()
     }

     await task
     expect(executed).toEqual([1])
   })

   it('should handle task resolution after pause', async () => {
     const scheduler = createScheduler()
     let resolved = false

     const promise = scheduler.schedule(async () => {
       await new Promise(r => setTimeout(r, 10))
       resolved = true
       return 'done'
     })

     scheduler.pause()
     await new Promise(r => setTimeout(r, 20))
     expect(resolved).toBe(false)

     scheduler.resume()
     await promise
     expect(resolved).toBe(true)
   })
 })
})