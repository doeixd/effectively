import { getEffectContext } from "./context"
import { defineEffect } from "./createEffect"
import { handleError } from "./errors"

export interface TaskOptions {
  priority?: number
  timeout?: number
  signal?: AbortSignal
  dependsOn?: Task<unknown>
  retryCount?: number
  retryDelay?: number
}

export interface Task<T> {
  id: string
  execute: () => T | Promise<T>
  priority: number
  resolver: (value: T | PromiseLike<T>) => void
  rejecter: (reason?: any) => void
  options: TaskOptions
  startTime?: number
  retryCount: number
  state: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
}

class PriorityQueue<T> {
  private heap: Task<T>[] = []
  private taskMap = new Map<string, Task<T>>()

  enqueue(task: Task<T>) {
    const priority = task.options.dependsOn
      ? Math.max(task.options.dependsOn.priority, task.priority)
      : task.priority

    task.priority = priority
    this.taskMap.set(task.id, task)
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

    this.taskMap.delete(result.id)
    return result
  }

  remove(taskId: string): boolean {
    const index = this.heap.findIndex(task => task.id === taskId)
    if (index === -1) return false

    this.taskMap.delete(taskId)
    const last = this.heap.pop()!

    if (index < this.heap.length) {
      this.heap[index] = last
      this.bubbleUp(index)
      this.bubbleDown(index)
    }

    return true
  }

  get(taskId: string): Task<T> | undefined {
    return this.taskMap.get(taskId)
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

  clear() {
    this.heap = []
    this.taskMap.clear()
  }
}

export function createScheduler() {
  const tasks = new PriorityQueue<unknown>()
  let isProcessing = false
  let paused = false

  return {
    schedule<T>(
      executable: () => T | Promise<T>,
      options: TaskOptions = {}
    ): Promise<T> {
      const { promise, resolve, reject } = Promise.withResolvers<T>()

      const task: Task<unknown> = {
        id: crypto.randomUUID(),
        execute: executable as () => unknown | Promise<unknown>,
        priority: options.priority ?? 0,
        resolver: resolve as (value: unknown | PromiseLike<unknown>) => void,
        rejecter: reject,
        options,
        retryCount: 0,
        state: 'pending'
      }

      // Handle abort signal
      if (options.signal) {
        if (options.signal.aborted) {
          reject(new Error('Task cancelled'))
          return promise
        }

        options.signal.addEventListener('abort', () => {
          if (task.state !== 'completed') {
            task.state = 'cancelled'
            tasks.remove(task.id)
            reject(new Error('Task cancelled'))
          }
        })
      }

      tasks.enqueue(task)

      if (!isProcessing && !paused) {
        this.process()
      }

      return promise
    },

    cancelTask(taskId: string) {
      const task = tasks.get(taskId)
      if (task && task.state !== 'completed') {
        task.state = 'cancelled'
        tasks.remove(taskId)
        task.rejecter(new Error('Task cancelled'))
      }
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

    clear() {
      tasks.clear()
      isProcessing = false
      paused = false
    },

    async process() {
      if (isProcessing || paused) return
      isProcessing = true

      while (tasks.size > 0 && !paused) {
        const task = tasks.dequeue()
        if (!task || task.state === 'cancelled') continue

        task.state = 'running'
        task.startTime = Date.now()

        try {
          // Handle timeout
          const timeoutPromise = task.options.timeout
            ? new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Task timeout')), task.options.timeout)
            })
            : null

          const result = await Promise.race([
            task.execute(),
            timeoutPromise
          ].filter(Boolean))

          task.state = 'completed'
          task.resolver(result)

        } catch (error) {
          // Handle retries
          if (task.retryCount < (task.options.retryCount ?? 0)) {
            task.retryCount++
            task.state = 'pending'

            if (task.options.retryDelay) {
              await new Promise(resolve =>
                setTimeout(resolve, task.options.retryDelay)
              )
            }

            tasks.enqueue(task)
            continue
          }

          task.state = 'failed'

          if (error instanceof Error) {
            try {
              const ctx = getEffectContext()
              if (ctx.runtime.currentErrorBoundary) {
                await ctx.runtime.currentErrorBoundary.handle(error)
              }
              task.rejecter(error)
            } catch (handlingError) {
              task.rejecter(handlingError)
            }
          } else {
            const unknownError = new Error('Unknown error occurred')
            const ctx = getEffectContext()
            if (ctx.runtime.currentErrorBoundary) {
              await ctx.runtime.currentErrorBoundary.handle(unknownError)
            }
            task.rejecter(unknownError)
          }
        }
      }

      isProcessing = false
    }
  }
}

export const schedule = defineEffect('schedule',
  async <T>(
    executable: () => T | Promise<T>,
    options: TaskOptions = {}
  ): Promise<T> => {
    const ctx = getEffectContext()
    return ctx.runtime.scheduler.schedule(executable, options)
  }
)
