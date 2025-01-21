import { createContext, withAsyncContext } from "unctx";
import { AsyncLocalStorage } from "node:async_hooks";
import { createScheduler } from "./scheduler";
import { EffectHandler } from "./createEffect";
import { ErrorHandlerMap, handleError } from "./errors";
import { cleanupResources, ResourceMap } from "./resource";

export interface EffectHandlerContext  {
  [key: string]: EffectHandler
} 

export interface EffectRuntimeContext {
  scheduler: ReturnType<typeof createScheduler>
  errorHandlers: ErrorHandlerMap
}

export interface EffectContext <H extends EffectHandlerContext = EffectHandlerContext, R extends EffectRuntimeContext = EffectRuntimeContext, Re extends ResourceMap<string> = ResourceMap<string>>  {
  handlers: H
  runtime: R
  resources: Re
}

declare global {
  var __effectContext__: EffectContext | undefined
}

export const effectContext = createContext<EffectContext>({
  asyncContext: true,
  AsyncLocalStorage
})

export const createDefaultEffectContext = <C extends EffectContext = EffectContext>() => (({
  handlers: {} as C['handlers'],
  runtime: ({
    scheduler: createScheduler(),
    errorHandlers: new Map() as ErrorHandlerMap
  }),
  resources: new Map() as ResourceMap
}))


export const setupGlobalEffectContext = <C extends EffectContext>() => { 
  globalThis['__effectContext__'] ||= createDefaultEffectContext<C>() 
  return globalThis['__effectContext__'] as C
}


export const getEffectContext = <C extends EffectContext> () => {
  try {
  var ctx = effectContext.use()
  } catch (e) {
    // @ts-expect-error
    ctx = undefined
  }

  if (ctx) return ctx as C
  return setupGlobalEffectContext<C>()
}

export type AnyFunction = (...args: any[]) => any


export const contextRoot = <C extends EffectContext> (cb: AnyFunction, context?: C) =>  effectContext.callAsync(context ? context : getEffectContext<C>(), withAsyncContext(async () => {
  try {
    return await cb()
  }  catch (e) {
    if (e instanceof Error) {
      await handleError(e)
    }
  } finally {
    await cleanupResources()
  }
}))

