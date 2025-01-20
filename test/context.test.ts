// context.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { 
 effectContext,
 createDefaultEffectContext,
 setupGlobalEffectContext,
 getEffectContext,
 contextRoot,
 type EffectContext
} from '../src/context'

describe('Context Management', () => {
 beforeEach(() => {
   // Reset global context before each test
   globalThis['__effectContext__'] = undefined
 })

 afterEach(() => {
   vi.restoreAllMocks()
 })

 describe('createDefaultEffectContext', () => {
   it('should create a context with default values', () => {
     const context = createDefaultEffectContext()
     
     expect(context).toHaveProperty('handlers')
     expect(context).toHaveProperty('runtime')
     expect(context.runtime).toHaveProperty('scheduler')
     expect(context.runtime).toHaveProperty('isProcessing', false)
   })

   it('should work with custom context types', () => {
     interface CustomHandlers {
       customHandler: (value: string) => void
     }

     type CustomContext = EffectContext & {
       handlers: CustomHandlers
     }

     const context = createDefaultEffectContext<CustomContext>()
     expect(context).toHaveProperty('handlers')
     expect(context.handlers).toEqual({})
   })
 })

 describe('setupGlobalEffectContext', () => {
   it('should create global context if none exists', () => {
     expect(globalThis['__effectContext__']).toBeUndefined()
     
     const context = setupGlobalEffectContext()
     
     expect(globalThis['__effectContext__']).toBeDefined()
     expect(globalThis['__effectContext__']).toBe(context)
   })

   it('should return existing context if already setup', () => {
     const firstContext = setupGlobalEffectContext()
     const secondContext = setupGlobalEffectContext()
     
     expect(firstContext).toBe(secondContext)
   })
 })

 describe('getEffectContext', () => {
   it('should return context from effectContext.use() if available', () => {
     const mockContext = createDefaultEffectContext()
     const useSpy = vi.spyOn(effectContext, 'use').mockReturnValue(mockContext)
     const context = getEffectContext()

     console.log({getEffectContext})
     
     expect(useSpy).toHaveBeenCalled()
     expect(context).toBe(mockContext)
   })

   it('should fall back to global context if no context from use()', () => {
    // @ts-expect-error
     vi.spyOn(effectContext, 'use').mockReturnValue(null)
     
     const context = getEffectContext()
     
     expect(context).toBe(globalThis['__effectContext__'])
   })
 })

 describe('contextRoot', () => {
   it('should execute callback within context', async () => {
     const mockContext = createDefaultEffectContext()
     const callAsyncSpy = vi.spyOn(effectContext, 'callAsync')

     await contextRoot(async () => {
       // Some operation
     }, mockContext)

     expect(callAsyncSpy).toHaveBeenCalledWith(
       mockContext,
       expect.any(Function)
     )
   })

   it('should use default context if none provided', async () => {
     const callAsyncSpy = vi.spyOn(effectContext, 'callAsync')

     await contextRoot(async () => {
       // Some operation
     })

     expect(callAsyncSpy).toHaveBeenCalled()
     expect(callAsyncSpy.mock.calls[0][0]).toEqual(
       expect.objectContaining({
         handlers: {},
         runtime: expect.any(Object)
       })
     )
   })

   it('should maintain async context through callbacks', async () => {
     const results: string[] = []
     
     await contextRoot(async () => {
       const ctx1 = getEffectContext()
       results.push('outer')
       
       await new Promise<void>(resolve => {
         setImmediate(async () => {
           const ctx2 = getEffectContext()
           results.push('inner')
           expect(ctx1).toBe(ctx2) // Same context maintained
           resolve()
         })
       })
     })

     expect(results).toEqual(['outer', 'inner'])
   })

   it('should handle nested context roots', async () => {
     const outerContext = createDefaultEffectContext()
     const innerContext = createDefaultEffectContext()
     
     const contexts: any[] = []

     await contextRoot(async () => {
       contexts.push(getEffectContext())
       
       await contextRoot(async () => {
         contexts.push(getEffectContext())
       }, innerContext)
       
       contexts.push(getEffectContext())
     }, outerContext)

     expect(contexts[0]).toBe(outerContext)
     expect(contexts[1]).toBe(innerContext)
     expect(contexts[2]).toBe(outerContext)
   })

   it('should properly handle errors in callbacks', async () => {
     const error = new Error('Test error')
     
     await expect(
       contextRoot(async () => {
         throw error
       })
     ).rejects.toThrow(error)
   })
 })

 describe('Type Safety', () => {
   it('should maintain type safety with custom contexts', async () => {
     interface CustomHandlers {
       testHandler: (value: string) => string
     }

     type CustomContext =  EffectContext & {
       handlers: CustomHandlers
     }

     const context = createDefaultEffectContext<CustomContext>()
     
     await contextRoot<CustomContext>(async () => {
       const ctx = getEffectContext<CustomContext>()
       expect(ctx.handlers).toBeDefined()
       
       // TypeScript should recognize this as an error:
      //  ts-expect-error
       ctx.handlers.nonExistentHandler
     }, context)
   })
 })
})