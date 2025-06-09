// import { contextRoot, defineEffect, defineHandler, getEffectContext } from '../src-old/index'

// await contextRoot(async () => {
//   const effect = defineEffect<(x: number) => string>('test', () => 'default')
//   defineHandler('test', (x: number) => `handled ${x}`)

//   const result = await effect(42)
//   console.log(result)
// })



import * as a from "../src/run";

  const { run, getContext, getContextSafe, getContextOrUndefined, defineTask } = createContext<AppContext>({
    api: {},
    logger: {},
  });



  defineTask(async (log: number) => {

  })