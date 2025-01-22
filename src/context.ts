import { createContext } from "unctx"
import { AsyncLocalStorage } from "node:async_hooks"
import { createScheduler } from "./scheduler"
import { EffectHandler } from "./createEffect"
import { ErrorHandlerMap, ErrorBoundary, handleError } from "./errors"
import { ResourcesMap } from "./resource"

declare global {
  var __effectContext__: EffectContext | undefined
}
export interface EffectHandlerContext {
  [key: string]: EffectHandler
}

export interface EffectRuntimeContext {
  scheduler: ReturnType<typeof createScheduler>
  errorHandlers: ErrorHandlerMap
  currentErrorBoundary?: ErrorBoundary
  metadata: Record<string, unknown>
}

export interface EffectContext<
  H extends EffectHandlerContext = EffectHandlerContext,
  R extends EffectRuntimeContext = EffectRuntimeContext,
  Re extends ResourcesMap = ResourcesMap
> {
  handlers: H
  runtime: R
  resources: Re
  parent?: EffectContext
  values: Map<string, unknown>
}

export const effectContext = createContext<EffectContext>({
  asyncContext: true,
  AsyncLocalStorage
})

export const createDefaultEffectContext = <C extends EffectContext = EffectContext>() => ({
  handlers: {} as C['handlers'],
  runtime: {
    scheduler: createScheduler(),
    errorHandlers: new Map() as ErrorHandlerMap,
    metadata: {},
    currentErrorBoundary: new ErrorBoundary()
  },
  resources: new Map() as ResourcesMap,
  values: new Map()
})

export const getEffectContext = <C extends EffectContext>() => {
  try {
    var ctx: EffectContext | undefined = effectContext.use()
  } catch (e) {
    ctx = undefined
  }

  if (ctx) return ctx as C
  return setupGlobalEffectContext<C>()
}

export const setupGlobalEffectContext = <C extends EffectContext>() => {
  if (!globalThis['__effectContext__']) {
    const ctx = createDefaultEffectContext<C>()
    ctx.runtime.currentErrorBoundary = new ErrorBoundary()
    globalThis['__effectContext__'] = ctx
  }
  return globalThis['__effectContext__'] as C
}

export function getValue<T>(key: string): T | undefined {
  const ctx = getEffectContext()
  const value = ctx.values.get(key)
  if (value !== undefined) return value as T
  
  if (ctx.parent) {
    return getValue<T>(key)
  }
  
  return undefined
}

export function setValue<T>(key: string, value: T): void {
  const ctx = getEffectContext()
  ctx.values.set(key, value)
}

export function createNestedContext<
  H extends EffectHandlerContext,
  R extends EffectRuntimeContext,
  Re extends ResourcesMap,
  C extends EffectContext<H, R, Re>
>(
  parent: C,
  options: {
    metadata?: Record<string, unknown>
    handlers?: Partial<H>
    errorBoundary?: boolean
  } = {}
): EffectContext<H, R, Re> {
  const parentBoundary = parent.runtime.currentErrorBoundary
  
  const nestedContext: EffectContext<H, R, Re> = {
    parent,
    values: new Map(),
    resources: new Map() as Re,
    handlers: Object.create(parent.handlers, 
      Object.getOwnPropertyDescriptors(options.handlers || {})) as H,
    runtime: {
      scheduler: parent.runtime.scheduler,
      errorHandlers: new Map(parent.runtime.errorHandlers),
      currentErrorBoundary: options.errorBoundary ? new ErrorBoundary(parentBoundary) : parentBoundary,
      metadata: { ...parent.runtime.metadata, ...options.metadata }
    } as R
  }
  
  return nestedContext
}

export const contextRoot = <C extends EffectContext>(
  cb: (...args: any[]) => any,
  context?: C
) => effectContext.callAsync(
  context ? context : getEffectContext<C>(),
  async () => {
    try {
      return await cb()
    } catch (error) {
      if (error instanceof Error) {
        const ctx = getEffectContext()
        if (ctx.runtime.currentErrorBoundary) {
          await handleError(error)
          // If handleError doesn't throw, we've recovered
          return undefined
        }
      }
      throw error
    } finally {
      await cleanupContext(getEffectContext())
    }
  }
)

export function withNestedContext<
  H extends EffectHandlerContext,
  R extends EffectRuntimeContext,
  Re extends ResourcesMap,
  C extends EffectContext<H, R, Re>
>(
  options?: {
    metadata?: Record<string, unknown>
    handlers?: Partial<H>
    errorBoundary?: boolean
  }
) {
  return (cb: (...args: any[]) => any) => 
    async () => {
      const parent = getEffectContext<C>()
      const nestedContext = createNestedContext<H, R, Re, C>(parent, options)
      return await contextRoot<C>(cb, nestedContext as C)
    }
}

export async function cleanupContext(context: EffectContext) {
  for (const [_, resource] of context.resources) {
    if (typeof resource === 'object' && resource !== null && 'cleanup' in resource) {
      try {
        await (resource as { cleanup: () => Promise<void> }).cleanup()
      } catch (e) {
        if (e instanceof Error && context.runtime.currentErrorBoundary) {
          await handleError(e, { rethrow: false })
        } else {
          console.error('Error during resource cleanup:', e)
        }
      }
    }
  }

  context.resources.clear()
  context.values.clear()
}