import { AnyFunction, EffectContext, getEffectContext } from "./context"
import { EffectHandler } from "./createEffect"

export interface IResource <T> {
  get (last?: T):  T
  cleanup(instance: T): T
}

export type ResourcesMap<TInstance = unknown> = Map<IResource<TInstance>, TInstance>

export function getResources(): ResourcesMap {
  const ctx = getEffectContext()
  return ctx.resources
}

export function getResourceValues<T = unknown>(): IResource<T>[] {
  const ctx = getEffectContext()
  return Array.from(ctx.resources.values()) as IResource<T>[]
}

export function getResourceValue <T>(resource: IResource<T>) {
  const ctx = getEffectContext()
  return ctx.resources.get(resource)
}

export async function cleanupResources<T>(resources?: IResource<T>[]) {
  const resourcePairs = (resources
    ? resources
        .map(resource => {
          const value = getResourceValue(resource);
          return value != null ? [resource, value] as const : null;
        })
        .filter((pair): pair is [IResource<T>, NonNullable<T>] => pair !== null)
    : [...getResources().entries()]);

  for (const [resource, value] of resourcePairs) {
    try {
      await resource?.cleanup?.(value)
    } catch (e) {
      console.error(`Error cleaning up resource`)
      console.error(e)
    }
  }
}

export function useResource<T extends object>(resource: IResource<T>) {
  const ctx = getEffectContext()
  const last = ctx.resources.get(resource) as NonNullable<T> | undefined
 
  const newResource = resource.get(last)
  ctx.resources.set(resource, newResource)

  return newResource
}

export function withResources<T extends object>(resources: IResource<T>[]) {
  return (cb: EffectHandler) => {
    return ((args: any[]) => {
      const usedResources = resources.map(resource => [resource, useResource(resource) as NonNullable<T>] as const)
      try {
        return cb(...args)
      } finally {
        usedResources.map(([resource, value]) => resource.cleanup(value))
      }
    }) as typeof cb
  }
}