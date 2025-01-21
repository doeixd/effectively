import { AnyFunction, EffectContext, getEffectContext } from "./context"


  
export interface IResource <T> {
  get ():  T
  cleanup(): T
}


// export interface IResource<T, M extends object = {}> {
//   value: undefined | T,
//   metadata: M
//   definition: IResourceDef<T> 
// }

// export interface IResourceDef <T, N extends string = string, M extends object = {}> {
//   create: (...args: any[]) => T,
//   aquire: (resource: T) => (...args: any[]) => T,
//   release?: (resource: T) => void | Promise<void>
//   cleanup: () => any,
//   name: N
// }

export type ResourceDefMap <N extends string = string> = Map<N, IResourceDef<any, N>>

export type ResourcesMap <T extends any = any> = Map<IResourceDef<T>, Set<IResource<T>>>

export function addResourceDefinitionToContent<T>(resource: IResource<T>, context?: EffectContext) {
  if (!context) {
    context = getEffectContext()
  }

  const old = context.resources.get(resource)

  context.resources.add(resource, {
    cleanup: (...args) => {


    },
    ...resource
  })
  
  return old
}

export function getResources () {
  const ctx = getEffectContext()
  return ctx.resources
}

export function getResource(name: string) {
  const ctx = getEffectContext()
  return ctx.resources.get(name)
}

export async function cleanupResources () {
  const resources = getResources()

  for (let [name, resource] of resources) {
    await resource?.cleanup?.()
    resources.delete(name)
  }
}

export function useResource (resource: IResourceDef<any> | string) {
  let r = 
  typeof resource == 'string' 
    ? typeof getResource(resource) == 'object' 
      ? getResource(resource)
      : typeof resource == 'object'
        ? resource
        : undefined
    : undefined

  if (!r) {
    throw new Error('Invalid resource found / provided')
  }

  addResourceToContext(r)

  const value = r.create()

  r.value = value






}

export function withResources(resources: IResourceDef[], cb: AnyFunction) {



}