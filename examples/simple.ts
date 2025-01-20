import { contextRoot, defineEffect, getEffectContext } from '../src/index'



await contextRoot(() => {

  const log = defineEffect('log', (...strs: string[]) => console.log(...strs))

  log('hello')
  


  


})
