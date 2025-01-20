import { createContext, withAsyncContext } from "unctx";
import { AsyncLocalStorage } from "node:async_hooks";
import { createScheduler } from "./scheduler";
import { EffectHandler } from "./createEffect";
import { ErrorHandlerMap } from "./errors";

export interface EffectHandlerContext  {
  [key: string]: EffectHandler
} 

export interface EffectRuntimeContext {
  scheduler: ReturnType<typeof createScheduler>
  errorHandlers: ErrorHandlerMap
}

export interface EffectContext <H extends EffectHandlerContext = EffectHandlerContext, R extends EffectRuntimeContext = EffectRuntimeContext>  {
  handlers: H
  runtime: R
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
  })
}))


export const setupGlobalEffectContext = <C extends EffectContext>() => { 
  globalThis['__effectContext__'] ||= createDefaultEffectContext<C>() 
  return globalThis['__effectContext__'] as C
}


export const getEffectContext = <C extends EffectContext> () => {
  const ctx = effectContext.use()
  if (ctx) return ctx as C
  return setupGlobalEffectContext<C>()
}

export type AnyFunction = (...args: any[]) => any


export const contextRoot = <C extends EffectContext> (cb: AnyFunction, context?: C) =>  effectContext.callAsync(context ? context : getEffectContext<C>(), withAsyncContext(async () => {
  await cb()
}))

