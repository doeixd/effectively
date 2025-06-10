import { describe, expect, expectTypeOf, it } from "vitest";
import { contextRoot, EffectContext, getEffectContext } from "../src-old/context";
import { defineEffect, defineHandler } from "../src-old/createEffect";



describe('Basics', () => {

  it('Get context outside of root', () => {
    const effectContext = getEffectContext()
    expectTypeOf(effectContext).toEqualTypeOf<EffectContext>()
  })

  it('Define effect outside context', () => {
    const log = defineEffect('log', (str: string) => {
      console.log(str)
      return str
    })

    const ret = log('hello world')
    expect(ret).toBe('hello world')
  })

  it('Define effect inside context', async () => {
    await contextRoot(() => {
      const log = defineEffect('log', (str: string) => {
        console.log(str)
        return str
      })

      const ret = log('hello world')
      expect(ret).toBe('hello world')
    })
  })

  it('Redefine default handler', async () => {
    await contextRoot(() => {
      const log = defineEffect('log', (str: string) => {
        console.log(str)
        return str
      })

      defineHandler('log', (str: string) => {
        return 'other'
      })

      const ret = log('hello world')

      expect(ret).toBe('other')
    })
  })







})