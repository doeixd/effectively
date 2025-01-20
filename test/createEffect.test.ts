// createEffect.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { 
 defineEffect,
 defineHandler,
 getPriorityValue,
 type Priority,
 type EffectHandler
} from '../src/createEffect'
import { getEffectContext } from '../src/context'
import { contextRoot } from '../src/context'

// Mock the context module
vi.mock('./context', async () => {
 const actual = await vi.importActual('./context')
 return {
   ...actual,
   getEffectContext: vi.fn()
 }
})

describe('Effect Creation and Handling', () => {
 beforeEach(() => {
   vi.clearAllMocks()
 })

 describe('defineEffect', () => {
   it('should create an effect with a default handler', () => {
     const mockCtx = {
       handlers: {},
       runtime: {
         scheduler: { schedule: vi.fn() },
         errorHandlers: new Map()
       }
     }
     // @ts-expect-error
     vi.mocked(getEffectContext).mockReturnValue(mockCtx)

     const defaultHandler = () => 'default result'
     const effect = defineEffect('test', defaultHandler)
     
     expect(effect).toBeInstanceOf(Function)
     expect(effect()).toBe('default result')
   })

   it('should throw when no context is available', () => {
     // @ts-expect-error
     vi.mocked(getEffectContext).mockReturnValue(null)

     const effect = defineEffect('test')
     expect(() => effect()).toThrow('No context provided')
   })

   it('should throw when no handler is found', () => {
     const mockCtx = {
       handlers: {},
       runtime: {
         scheduler: { schedule: vi.fn() }
       }
     }
     // @ts-expect-error
     vi.mocked(getEffectContext).mockReturnValue(mockCtx)

     const effect = defineEffect('test')
     expect(() => effect()).toThrow('No effect handler found')
   })

   it('should use defined handler over default handler', async () => {
     await contextRoot(async () => {
       const effect = defineEffect<(x: number) => string>('test', () => 'default')
       defineHandler('test', (x: number) => `handled ${x}`)

       const result = effect(42)
       expect(result).toBe('handled 42')
     })
   })

   it('should properly type the effect parameters', async () => {
     await contextRoot(async () => {
       const effect = defineEffect<(x: number, y: string) => boolean>('test')
       
       defineHandler('test', (x: number, y: string) => {
         return x > 0 && y.length > 0
       })

       // These should type check:
       effect(42, 'test')
       
       // These should not type check:
       // @ts-expect-error
       effect('wrong', 123)
       // @ts-expect-error
       effect(42)
     })
   })
 })

 describe('defineHandler', () => {
   it('should register a handler in the context', async () => {
     await contextRoot(async () => {
       const handler = vi.fn()
       defineHandler('test', handler)

       const ctx = getEffectContext()
       expect(ctx.handlers['test']).toBeDefined()
     })
   })

   it('should wrap handler with scheduler except for "then"', async () => {
     await contextRoot(async () => {
       const scheduleSpy = vi.spyOn(getEffectContext().runtime.scheduler, 'schedule')
       
       // Normal handler
       defineHandler('test', () => 'result')
       const effect = defineEffect('test')
       await effect()
       
       expect(scheduleSpy).toHaveBeenCalled()

       // 'then' handler
       defineHandler('then', () => 'result')
       const thenEffect = defineEffect('then')
       await thenEffect()
       
       // Should not be scheduled
       expect(scheduleSpy).toHaveBeenCalledTimes(1)
     })
   })

   it('should throw with invalid handlers', async () => {
     await contextRoot(async () => {
       // @ts-expect-error
       expect(() => defineHandler('test', null)).toThrow()
       // @ts-expect-error
       expect(() => defineHandler('test', 'not a function')).toThrow()
     })
   })
 })

 describe('getPriorityValue', () => {
   it('should convert string priorities to numbers', () => {
     expect(getPriorityValue('high')).toBe(2)
     expect(getPriorityValue('medium')).toBe(1)
     expect(getPriorityValue('low')).toBe(0)
   })

   it('should pass through numeric priorities', () => {
     expect(getPriorityValue(5)).toBe(5)
     expect(getPriorityValue(0)).toBe(0)
     expect(getPriorityValue(-1)).toBe(-1)
   })

   it('should handle all Priority type values', () => {
     const priorities: Priority[] = ['high', 'medium', 'low', 0, 1, 2]
     priorities.forEach(p => {
       expect(() => getPriorityValue(p)).not.toThrow()
     })
   })
 })

 describe('Integration Tests', () => {
   it('should handle complex effect chains', async () => {
     await contextRoot(async () => {
       const effect1 = defineEffect<(x: number) => Promise<number>>('effect1')
       const effect2 = defineEffect<(x: number) => Promise<string>>('effect2')

       defineHandler('effect1', async (x: number) => x * 2, 'high')
       defineHandler('effect2', async (x: number) => `result: ${x}`, 'low')

       const result = await effect2(await effect1(21))
       expect(result).toBe('result: 42')
     })
   })

   it('should maintain handler priority order', async () => {
     await contextRoot(async () => {
       const order: string[] = []
       
       const effect = defineEffect<() => void>('test')
       
       defineHandler('test', () => {
         order.push('high')
       }, 'high')

       defineHandler('test', () => {
         order.push('low')
       }, 'low')

       await effect()
       
       expect(order).toEqual(['high', 'low'])
     })
   })
 })

 describe('Type Safety', () => {
   it('should enforce handler signature matching', async () => {
     await contextRoot(async () => {
       const effect = defineEffect<(x: number) => string>('test')

       // These should type check:
       defineHandler('test', (x: number) => x.toString())
       
       // These should not type check:
       defineHandler('test', (x: string) => x)
       defineHandler('test', () => 42)
     })
   })

   it('should preserve return type', async () => {
     await contextRoot(async () => {
       const effect = defineEffect<() => Promise<number>>('test')
       defineHandler('test', async () => 42)

       const result = await effect()
       // TypeScript should know this is a number
       const doubled: number = result * 2
       expect(doubled).toBe(84)
     })
   })
 })
})