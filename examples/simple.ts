import { contextRoot, defineEffect, defineHandler, getEffectContext } from '../src/index'





await contextRoot(async () => {
  const effect = defineEffect<(x: number) => string>('test', () => 'default')
  defineHandler('test', (x: number) => `handled ${x}`)

  const result = await effect(42)
  console.log(result)
})