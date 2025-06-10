import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { IResource, ResourcesMap, getResources, getResourceValues, getResourceValue, cleanupResources, useResource, withResources } from '../src-old/resource'
import { getEffectContext, setupGlobalEffectContext, EffectContext } from '../src-old/context'
import { EffectHandler } from '../src-old/createEffect'

describe('Resource Management', () => {
  let mockContext: EffectContext
  let mockResource: IResource<{ id: number }>
  
  beforeEach(() => {
    mockContext = setupGlobalEffectContext()
    mockResource = {
      get: vi.fn((last) => ({ id: last?.id ?? 1 })),
      cleanup: vi.fn((instance) => instance)
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getResources', () => {
    it('should return ResourcesMap from context', () => {
      const resources = getResources()
      expect(resources).toBeInstanceOf(Map)
    })
  })

  describe('getResourceValues', () => {
    it('should return array of resource values', () => {
      const ctx = getEffectContext()
      ctx.resources.set(mockResource, { id: 1 })
      
      const values = getResourceValues()
      expect(values).toContainEqual(mockResource)
    })
  })

  describe('getResourceValue', () => {
    it('should return value for given resource', () => {
      const ctx = getEffectContext()
      const value = { id: 1 }
      ctx.resources.set(mockResource, value)
      
      const result = getResourceValue(mockResource)
      expect(result).toEqual(value)
    })

    it('should return undefined for non-existent resource', () => {
      const result = getResourceValue(mockResource)
      expect(result).toBeUndefined()
    })
  })

  describe('cleanupResources', () => {
    it('should cleanup specified resources', () => {
      const ctx = getEffectContext()
      const value = { id: 1 }
      ctx.resources.set(mockResource, value)
      
      cleanupResources([mockResource])
      expect(mockResource.cleanup).toHaveBeenCalledWith(value)
      expect(ctx.resources.has(mockResource)).toBeFalsy()
    })

    it('should cleanup all resources if none specified', () => {
      const ctx = getEffectContext()
      const value = { id: 1 }
      ctx.resources.set(mockResource, value)
      
      cleanupResources()
      expect(mockResource.cleanup).toHaveBeenCalledWith(value)
      expect(ctx.resources.size).toBe(0)
    })
  })

  describe('useResource', () => {
    it('should get and set resource value', () => {
      const result = useResource(mockResource)
      
      expect(mockResource.get).toHaveBeenCalled()
      expect(result).toEqual({ id: 1 })
      
      const ctx = getEffectContext()
      expect(ctx.resources.get(mockResource)).toEqual({ id: 1 })
    })

    it('should pass previous value to get', () => {
      const ctx = getEffectContext()
      ctx.resources.set(mockResource, { id: 2 })
      
      useResource(mockResource)
      expect(mockResource.get).toHaveBeenCalledWith({ id: 2 })
    })
  })

  describe('withResources', () => {
    it('should manage resources lifecycle', async () => {
      const handler: EffectHandler = vi.fn()
      const wrappedHandler = withResources([mockResource], handler)
      
      await wrappedHandler([])
      
      expect(mockResource.get).toHaveBeenCalled()
      expect(handler).toHaveBeenCalled()
      expect(mockResource.cleanup).toHaveBeenCalled()
    })

    it('should cleanup resources even if handler throws', async () => {
      const error = new Error('Test error')
      const handler: EffectHandler = vi.fn().mockImplementation(() => {
        throw error
      })
      
      const wrappedHandler = withResources([mockResource], handler)
      
      await expect(wrappedHandler([])).rejects.toThrow(error)
      expect(mockResource.cleanup).toHaveBeenCalled()
    })
  })
})
