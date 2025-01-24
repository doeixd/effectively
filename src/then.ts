import { getEffectContext } from "./context";
import { defineEffect, defineHandler } from "./createEffect";

export type ContinuationFn<T, R> = (value: T) => R
export type QueuedContinuation<T> = () => T

export interface ContinuationQueue<T> {
    queue: QueuedContinuation<T>[]
    isProcessing: boolean
    enqueue: (cont: QueuedContinuation<T>) => void
    processQueue: () => T | undefined
}


export function createContinuationQueue<T>(): ContinuationQueue<T> {
    const queue: QueuedContinuation<T>[] = []
    let isProcessing = false

    return {
        queue,
        isProcessing,
        enqueue(continuation: QueuedContinuation<T>) {
            queue.push(continuation)
        },
        processQueue(): T | undefined {
            if (!isProcessing) {
                isProcessing = true
                let result: T | undefined
                while (queue.length > 0) {
                    const next = queue.shift()
                    if (next) {
                        result = next()
                    }
                }
                isProcessing = false
                return result
            }
            return undefined
        }
    }
}


// Core types
export type Next<In, Out> = (value: In) => Out | Promise<Out>

// Main continuation effect
export type ThenFn = <T, R>(next: Next<T, R>, value: T) => Promise<R>
export const then = defineEffect<ThenFn>('then')

// Helper to create continuations
export function Cont<T, R>(fn: (next: Next<T, R>) => (value: T) => R | Promise<R>) {
   return function(next: Next<T, R>) {
       return fn(next)
   }
}

// Example usage:
/*
const getUserDetails = Cont(next => async (userId: string) => {
   const user = await fetchUser(userId)
   return then(next, user)
})

const verifyUser = Cont(next => async (user: User) => {
   const verified = await validateUser(user)
   return then(next, verified)
})

const processUser = chain(
   getUserDetails,
   verifyUser,
   (verifiedUser) => formatUserData(verifiedUser)
)
*/

// Initialize continuation handling
export function setupContinuationHandlers() {
   defineHandler('then', async <T, R>(next: Next<T, R>, value: T): Promise<R> => {
       const ctx = getEffectContext()
       
       return ctx.runtime.scheduler.schedule(
           () => Promise.resolve(next(value))
       )
   })
}

// Helper to chain multiple continuations
export function chain<T>(...continuations: Array<(next: Next<any, any>) => Next<any, any>>) {
   return continuations.reduceRight(
       (acc, cont) => cont(acc),
       (x: T) => x
   )
}