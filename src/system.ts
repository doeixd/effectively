import { createContext, type BaseContext } from './run';
import { createEffectSuite, type EffectsSchema } from './handlers';
import { type ContextWithEffects } from './run';

/**
 * Creates a new, fully integrated "Effectively" system, providing a
 * unified set of tools that are pre-configured to work together with
 * end-to-end type safety.
 *
 * This is the recommended entry point for new applications, as it eliminates
 * the need to manually combine context and effect handler types.
 *
 * @template TContext The specific type of your application's context (e.g., `{ userId: string; }`).
 * @template TEffects The type contract defining your application's effects (e.g., `{ log: (msg: string) => void; }`).
 * @param config An object containing the default data for your context.
 * @returns A complete set of tools (`run`, `getContext`, `effects`, `withHandlers`, etc.)
 *          that are all aware of both your context and your effects contract.
 */
export function createEffectiveSystem<
  TContext extends BaseContext,
  TEffects extends EffectsSchema
>(config: { context: Omit<TContext, 'scope'> }) {

  // 1. Create the combined context type internally using our new helper
  type CombinedContext = ContextWithEffects<TContext>;

  // 2. Create the context tools, typed to the combined interface
  const contextTools = createContext<CombinedContext>(config.context as any);

  // 3. Create the effect tools, typed to the effects contract
  const effectTools = createEffectSuite<TEffects>();

  // 4. Return a merged object containing all tools
  return {
    ...contextTools,
    ...effectTools
  };
}

// #### How to Use `createEffectiveSystem` (The New Recommended Pattern)

// This example shows how the new factory solves your original problem elegantly.

// ```typescript
// import { createEffectiveSystem, type BaseContext } from '@doeixd/effectively';

// // 1. Define your context and effects types as usual.
// interface AppContext extends BaseContext {
//   site: string;
// }
// type AppEffects = {
//   log: (message: string) => void;
//   getUniqueId: () => string;
// };

// // 2. Use the new factory to create a fully integrated system.
// //    Pass both types as generics and provide the default context data.
// const {
//   run,
//   getContext,
//   defineTask,
//   effects,
//   createHandlers,
//   withHandlers
// } = createEffectiveSystem<AppContext, AppEffects>({
//   context: { site: 'MYLIGHT' }
// });

// // 3. Define tasks and handlers using the tools from the system.
// //    Everything is automatically and correctly typed.
// const myTask = defineTask(async () => {
//   const { site } = getContext(); // ✅ Correctly infers `site` property
//   const id = await effects.getUniqueId();
//   await effects.log(`Task run with ID: ${id} for ${site}`);
// });

// const myHandlers = createHandlers({
//   // ✅ `createHandlers` is now fully aware of the `AppEffects` type.
//   //    A typo or missing handler here would cause a compile-time error.
//   log: (message) => console.log(`[SYSTEM LOG] ${message}`),
//   getUniqueId: () => 'integrated-id-456',
// });

// // 4. Run the task.
// //    ✅ The `run` function now understands the shape of `withHandlers`
// //       because it was created from the same integrated system. No type errors!
// async function runExample() {
//   await run(myTask, undefined, withHandlers(myHandlers));
// }

// runExample().catch(console.error);