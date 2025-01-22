import { getEffectContext } from "./context"
import { defineEffect } from "./createEffect"
import { handleError } from "./errors"

export interface Task<T> {
    execute: () => T | Promise<T>
    priority: number
    resolver: (value: T | PromiseLike<T>) => void
}

class PriorityQueue<T> {
    private heap: Task<T>[] = []
    
    enqueue(task: Task<T>, dependsOn?: Task<unknown>) {
        const priority = dependsOn ? Math.max(dependsOn.priority, task.priority) : task.priority
        task.priority = priority

        this.heap.push(task)
        this.bubbleUp(this.heap.length - 1)
    }
    
    dequeue(): Task<T> | undefined {
        if (this.heap.length === 0) return undefined
        
        const result = this.heap[0]
        const last = this.heap.pop()!
        
        if (this.heap.length > 0) {
            this.heap[0] = last
            this.bubbleDown(0)
        }
        
        return result
    }
    
    private bubbleUp(index: number) {
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2)
            if (this.heap[parentIndex].priority >= this.heap[index].priority) break
            
            [this.heap[parentIndex], this.heap[index]] = 
                [this.heap[index], this.heap[parentIndex]]
            index = parentIndex
        }
    }
    
    private bubbleDown(index: number) {
        while (true) {
            let highestPriority = index
            const leftChild = 2 * index + 1
            const rightChild = 2 * index + 2
            
            if (leftChild < this.heap.length && 
                this.heap[leftChild].priority > this.heap[highestPriority].priority) {
                highestPriority = leftChild
            }
            
            if (rightChild < this.heap.length && 
                this.heap[rightChild].priority > this.heap[highestPriority].priority) {
                highestPriority = rightChild
            }
            
            if (highestPriority === index) break
            
            [this.heap[index], this.heap[highestPriority]] = 
                [this.heap[highestPriority], this.heap[index]]
            index = highestPriority
        }
    }

    get size() {
        return this.heap.length
    }
}

export function createScheduler() {
    const tasks = new PriorityQueue<unknown>()
    let isProcessing = false
    let paused = false
    
    return {
        schedule<T>(executable: () => T | Promise<T>, priority = 0, dependsOn?: Task<unknown>): Promise<T> {
            const { promise, resolve } = Promise.withResolvers<T>()
            
            const task: Task<unknown> = {
                execute: executable as () => unknown | Promise<unknown>,
                priority,
                resolver: resolve as (value: unknown | PromiseLike<unknown>) => void
            }
            
            tasks.enqueue(task, dependsOn)

            if (!isProcessing && !paused) {
                this.process()
            }

            return promise
        },

        pause() {
            paused = true
        },

        resume() {
            if (paused) {
                paused = false
                if (tasks.size > 0) {
                    this.process()
                }
            }
        },

        async process() {
            if (isProcessing || paused) return
            isProcessing = true

            while (tasks.size > 0 && !paused) {
                const task = tasks.dequeue()
                if (!task) continue

                try {
                    const result = await task.execute()
                    task.resolver(result)
                } catch (error) {
                    if (error instanceof Error) {
                        try {
                            await handleError(error)
                            task.resolver(Promise.reject(error))
                        } catch (handlingError) {
                            task.resolver(Promise.reject(handlingError))
                        }
                    } else {
                        const unknownError = new Error('Unknown error occurred')
                        await handleError(unknownError)
                        task.resolver(Promise.reject(unknownError))
                    }
                }
            }

            isProcessing = false
        }
    }
}

export const schedule = defineEffect('schedule', 
    async <T>(executable: () => T | Promise<T>, priority = 0): Promise<T> => {
        const ctx = getEffectContext()
        return ctx.runtime.scheduler.schedule(executable, priority)
    }
)