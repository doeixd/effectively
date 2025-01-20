// errorHandling.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { 
 handleError,
 registerErrorHandler,
 ValidationError,
 DatabaseError,
 type ErrorHandler 
} from '../src/errors'
import { contextRoot } from '../src/context'

describe('Error Handling System', () => {
 // Spy on console.error for default handler
 beforeEach(() => {
   vi.spyOn(console, 'error').mockImplementation(() => {})
 })

 describe('Error Handler Registration', () => {
   it('should register and use specific error handlers', async () => {
     await contextRoot(async () => {
       const validationHandler = vi.fn()
       registerErrorHandler(ValidationError, validationHandler)

       const error = new ValidationError('Invalid input')
       await handleError(error)

       expect(validationHandler).toHaveBeenCalledWith(error)
     })
   })

   it('should handle multiple error types', async () => {
     await contextRoot(async () => {
       const validationHandler = vi.fn()
       const databaseHandler = vi.fn()

       registerErrorHandler(ValidationError, validationHandler)
       registerErrorHandler(DatabaseError, databaseHandler)

       await handleError(new ValidationError('Invalid'))
       await handleError(new DatabaseError('DB Error'))

       expect(validationHandler).toHaveBeenCalledTimes(1)
       expect(databaseHandler).toHaveBeenCalledTimes(1)
     })
   })

   it('should initialize error handlers map if not exists', async () => {
     await contextRoot(async () => {
       const handler = vi.fn()
       
       // Should not throw
       expect(() => 
         registerErrorHandler(ValidationError, handler)
       ).not.toThrow()
     })
   })
 })

 describe('Error Handler Inheritance', () => {
   class SpecificValidationError extends ValidationError {
     constructor(message: string) {
       super(message)
       this.name = 'SpecificValidationError'
     }
   }

   it('should use parent error handler if specific one not found', async () => {
     await contextRoot(async () => {
       const validationHandler = vi.fn()
       registerErrorHandler(ValidationError, validationHandler)

       const error = new SpecificValidationError('Very specific')
       await handleError(error)

       expect(validationHandler).toHaveBeenCalledWith(error)
     })
   })

   it('should prefer more specific handler when available', async () => {
     await contextRoot(async () => {
       const generalHandler = vi.fn()
       const specificHandler = vi.fn()

       registerErrorHandler(ValidationError, generalHandler)
       registerErrorHandler(SpecificValidationError, specificHandler)

       const error = new SpecificValidationError('Very specific')
       await handleError(error)

       expect(specificHandler).toHaveBeenCalledWith(error)
       expect(generalHandler).not.toHaveBeenCalled()
     })
   })

   it('should traverse prototype chain until handler found', async () => {
     await contextRoot(async () => {
       class VerySpecificError extends SpecificValidationError {
         constructor(message: string) {
           super(message)
           this.name = 'VerySpecificError'
         }
       }

       const validationHandler = vi.fn()
       registerErrorHandler(ValidationError, validationHandler)

       const error = new VerySpecificError('Extremely specific')
       await handleError(error)

       expect(validationHandler).toHaveBeenCalledWith(error)
     })
   })
 })

 describe('Default Error Handling', () => {
   it('should use default handler when no specific handler found', async () => {
     await contextRoot(async () => {
       const error = new Error('Generic error')
       
       await expect(handleError(error)).rejects.toThrow(error)
       expect(console.error).toHaveBeenCalledWith('Unhandled error:', error)
     })
   })

   it('should not call console.error when handler exists', async () => {
     await contextRoot(async () => {
       const handler = vi.fn()
       registerErrorHandler(Error, handler)

       await handleError(new Error('Test'))
       
       expect(console.error).not.toHaveBeenCalled()
     })
   })
 })

 describe('Async Error Handling', () => {
   it('should handle async error handlers', async () => {
     await contextRoot(async () => {
       const asyncHandler: ErrorHandler<ValidationError> = async (error) => {
         await new Promise(r => setTimeout(r, 10))
         return
       }

       registerErrorHandler(ValidationError, asyncHandler)
       const error = new ValidationError('Async test')
       
       // Should resolve without throwing
       await expect(handleError(error)).resolves.not.toThrow()
     })
   })

   it('should propagate errors from handlers', async () => {
     await contextRoot(async () => {
       const handlerError = new Error('Handler failed')
       const failingHandler = async () => {
         throw handlerError
       }

       registerErrorHandler(ValidationError, failingHandler)
       
       await expect(
         handleError(new ValidationError('Test'))
       ).rejects.toThrow(handlerError)
     })
   })
 })

 describe('Edge Cases', () => {
   it('should handle non-error objects correctly', async () => {
     await contextRoot(async () => {
       // @ts-expect-error - Testing runtime behavior
       await expect(handleError({ message: 'Not an error' }))
         .rejects.toThrow()
     })
   })

   it('should handle registration of invalid handlers', async () => {
     await contextRoot(async () => {
       // @ts-expect-error - Testing runtime behavior
       expect(() => registerErrorHandler(ValidationError, 'not a function'))
         .toThrow()
     })
   })

   it('should handle multiple registrations for same error type', async () => {
     await contextRoot(async () => {
       const handler1 = vi.fn()
       const handler2 = vi.fn()

       registerErrorHandler(ValidationError, handler1)
       registerErrorHandler(ValidationError, handler2)

       await handleError(new ValidationError('Test'))
       
       expect(handler1).not.toHaveBeenCalled()
       expect(handler2).toHaveBeenCalled()
     })
   })
 })

 describe('Integration with Context', () => {
   it('should maintain separate handlers per context', async () => {
     const handler1 = vi.fn()
     const handler2 = vi.fn()

     await contextRoot(async () => {
       registerErrorHandler(ValidationError, handler1)
       await handleError(new ValidationError('Test 1'))
     })

     await contextRoot(async () => {
       registerErrorHandler(ValidationError, handler2)
       await handleError(new ValidationError('Test 2'))
     })

     expect(handler1).toHaveBeenCalledTimes(1)
     expect(handler2).toHaveBeenCalledTimes(1)
   })
 })
})