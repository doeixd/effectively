/**
 * @module
 * This module implements the "Effects Handler" pattern, a powerful way to
 * decouple the declaration of side effects (the "what") from their implementation
 * (the "how"). This enables maximum testability and allows for swapping
 * implementations at runtime.
 *
 * ---
 *
 * ### Recommended Usage
 *
 * - For **multiple effects** in an application, use `createEffectSuite` for the best end-to-end type safety.
 * - For a **single effect** or for one-off overrides in tests, use `defineEffect` and its attached `.withHandler()` method for a clean, safe, and ergonomic API.
 *
 * Standalone helpers are also available for backward compatibility and advanced use cases.
 */

import { getContext, type BaseContext } from './run';

// =================================================================
// Section 1: Core Types, Symbols, and Errors
// =================================================================

/**
 * A unique `Symbol` used as the key for the effects handler map within the context.
 * Using `Symbol.for()` ensures that even if multiple versions of this library
 * are present in a project, they will all share the same symbol, guaranteeing interoperability.
 */
export const HANDLERS_KEY = Symbol.for('effectively.handlers');

/** A generic type representing the shape of any function. */
type AnyFn = (...args: any[]) => any;

/** An object type where keys are strings and values are functions. Used as a generic constraint. */
type EffectsSchema = Record<string, AnyFn>;

/**
 * Represents a callable effect function. It is an async-first version of the
 * function signature `T`.
 */
export type Effect<T extends AnyFn> = 
  (...args: Parameters<T>) => Promise<ReturnType<T>>;

/** A generic mapping of effect names to their concrete handler implementations. */
export type Handlers = Record<string, AnyFn>;

/**
 * The return type of the `defineEffect` function. It is the callable effect
 * function with attached helper methods for easily providing an implementation.
 */
export type EffectWithHelpers<T extends AnyFn> = Effect<T> & {
  /**
   * Creates run options with a handler for this specific effect. This is the
   * safest and most convenient way to provide a one-off implementation for an
   * effect, especially in tests.
   * @param implementation The function that implements the effect. Its signature
   * is validated against the effect's definition.
   */
  withHandler: (implementation: T) => { overrides: { [HANDLERS_KEY]: Handlers } };
  /**
   * Creates a single-entry `Handlers` object for this effect. Useful when
   * combining multiple handlers from different effects.
   * @param implementation The function that implements the effect.
   */
  createHandler: (implementation: T) => Handlers;
};

/** The return type of `defineEffects` or the `effects` property from `createEffectSuite`. */
type EffectsSuite<T extends EffectsSchema> = { [K in keyof T]: EffectWithHelpers<T[K]> };

/** The shape a context must have to support the effects pattern. */
export interface EffectsContext extends BaseContext {
  [HANDLERS_KEY]?: Handlers;
}

/**
 * An error thrown when an effect is called but no corresponding handler
 * has been provided in the context at runtime.
 */
export class EffectHandlerNotFoundError extends Error {
  constructor(public readonly effectName: string) {
    super(`Handler for effect "${effectName}" not found. Ensure it's provided to the 'run' call using 'withHandlers()' or '.withHandler()'.`);
    this.name = 'EffectHandlerNotFoundError';
    Object.setPrototypeOf(this, EffectHandlerNotFoundError.prototype);
  }
}

// =================================================================
// Section 2: Recommended Patterns (`createEffectSuite` and `defineEffect`)
// =================================================================

/**
 * Creates a complete, type-safe suite for managing a domain of **multiple effects**.
 *
 * This is the **recommended entry point** for full applications. It takes a single
 * generic argument (your effects contract) and returns a matched set of tools that
 * provide end-to-end type safety.
 *
 * @template T A `type` or `interface` that defines the effect names and their function signatures.
 */
export function createEffectSuite<T extends EffectsSchema>(): {
  effects: EffectsSuite<T>,
  createHandlers: (handlers: T) => T;
  withHandlers: (handlers: T) => { overrides: { [HANDLERS_KEY]: Handlers } };
} {
  const effectCache: Partial<EffectsSuite<T>> = {};
  
  const effects = new Proxy({} as EffectsSuite<T>, {
    get(_target, prop) {
      const effectName = String(prop) as keyof T;
      if (effectCache[effectName]) {
        return effectCache[effectName];
      }
      const newEffect = defineEffect(effectName as string) as EffectWithHelpers<T[keyof T]>;
      effectCache[effectName] = newEffect;
      return newEffect;
    },
  });

  return {
    effects,
    createHandlers: (handlers: T): T => handlers,
    withHandlers: (handlers: T) => ({
      overrides: { [HANDLERS_KEY]: handlers as Handlers },
    }),
  };
}

/**
 * Defines a **single, typed effect**. This is the recommended way to handle individual
 * effects or one-off overrides in tests.
 *
 * It returns a directly callable, async effect function. For convenience,
 * it also comes with attached helper methods (`.withHandler` and `.createHandler`)
 * to make providing a single implementation safe and easy.
 *
 * @template T The function signature of the effect.
 * @param effectName A unique string identifier for this effect.
 * @returns A callable `Effect` function with attached helpers.
 *
 * @example (Providing a one-off override in a test)
 * ```typescript
 * const getUniqueId = defineEffect<() => string>('getUniqueId');
 *
 * test('should use a predictable ID', async () => {
 *   const user = await run(
 *     createUserTask,
 *     'test-user',
 *     getUniqueId.withHandler(() => 'test-id-123') // ✅ Simple and type-safe!
 *   );
 *   expect(user.id).toBe('test-id-123');
 * });
 * ```
 */
export function defineEffect<T extends AnyFn>(
  effectName: string
): EffectWithHelpers<T> {
  const effectFn = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const context = getContext<EffectsContext>();
    const handler = context[HANDLERS_KEY]?.[effectName];
    if (typeof handler !== 'function') {
      throw new EffectHandlerNotFoundError(effectName);
    }
    return await handler(...args) as ReturnType<T>;
  };

  Object.defineProperty(effectFn, 'name', { value: effectName, configurable: true });

  const helpers = {
    withHandler: (implementation: T) => ({
      overrides: { [HANDLERS_KEY]: { [effectName]: implementation } },
    }),
    createHandler: (implementation: T): Handlers => ({
      [effectName]: implementation,
    }),
  };

  return Object.assign(effectFn, helpers) as EffectWithHelpers<T>;
}


// =================================================================
// Section 3: Legacy & Advanced Standalone Helpers
// =================================================================
// These functions are preserved for backward compatibility and advanced use cases.
// For new code, prefer the patterns in Section 2.
// =================================================================

// --- `defineEffects` ---
export function defineEffects<T extends EffectsSchema>(): EffectsSuite<T>;
export function defineEffects<T extends EffectsSchema>(effectsConfig: T): EffectsSuite<T>;
/**
 * [Legacy] Defines multiple effects at once from a single definition.
 * @deprecated For new projects, prefer `createEffectSuite`.
 */
export function defineEffects<T extends EffectsSchema>(...args: [T] | []): EffectsSuite<T> {
  if (args.length > 0) {
    const effectsConfig = args[0];
    const newEffects = {} as EffectsSuite<T>;
    for (const effectName in effectsConfig) {
      if (Object.prototype.hasOwnProperty.call(effectsConfig, effectName)) {
        newEffects[effectName] = defineEffect<T[typeof effectName]>(effectName);
      }
    }
    return newEffects;
  }
  const effectCache: Partial<EffectsSuite<T>> = {};
  return new Proxy({} as EffectsSuite<T>, {
    get(_target, prop) {
      const effectName = String(prop) as keyof T;
      if (effectCache[effectName]) {
        return effectCache[effectName];
      }
      const newEffect = defineEffect(effectName as string) as EffectWithHelpers<T[keyof T]>;
      effectCache[effectName] = newEffect;
      return newEffect;
    },
  });
}

// --- `createHandlers` ---
export function createHandlers<T extends EffectsSchema>(handlers: T): T;
export function createHandlers(handlers: Handlers): Handlers;
/**
 * [Legacy] Creates a handlers object. Can be made safer by providing an explicit generic.
 * @example createHandlers<AppEffects>({ ... })
 */
export function createHandlers(handlers: Handlers): Handlers {
  return handlers;
}

// --- `withHandlers` (for multiple handlers) ---
export function withHandlers<T extends EffectsSchema>(handlers: T): { overrides: { [HANDLERS_KEY]: T } };
export function withHandlers(handlers: Handlers): { overrides: { [HANDLERS_KEY]: Handlers } };
/**
 * [Legacy] Creates run options with a set of multiple handlers. Can be made safer
 * by providing an explicit generic.
 * @example withHandlers<AppEffects>({ log: console.log, ... })
 */
export function withHandlers(handlers: Handlers) {
  return { overrides: { [HANDLERS_KEY]: handlers } };
}

// --- `withHandler` (for a single handler) ---

/**
 * [Advanced] Creates run options for a single handler by providing the full
 * effects suite, the name of the effect to handle, and its implementation.
 * @param effectsSuite The full `effects` object from `createEffectSuite` or `defineEffects`.
 * @param effectName The key of the effect within the suite to provide a handler for.
 * @param implementation The function that implements the effect.
 * @example run(myTask, withHandler(effects, 'getUniqueId', () => 'test-id'))
 */
export function withHandler<T extends EffectsSchema, K extends keyof T>(
  effectsSuite: EffectsSuite<T>,
  effectName: K,
  implementation: T[K]
): { overrides: { [HANDLERS_KEY]: Handlers } };
/**
 * [Advanced] Creates run options for a single handler by providing its
 * signature via a generic, its name, and its implementation.
 * @template T The function signature of the effect.
 * @param effectName The unique string name of the effect.
 * @param implementation The function that implements the effect.
 * @example run(myTask, withHandler<() => string>('getUniqueId', () => 'test-id'))
 */
export function withHandler<T extends AnyFn>(
  effectName: string,
  implementation: T
): { overrides: { [HANDLERS_KEY]: Handlers } };
/**
 * [Advanced] A standalone function to create run options for a single handler
 * by providing the effect object and its implementation.
 * @param effect The effect object returned by `defineEffect`.
 * @param implementation The function that implements the effect.
 * @example run(myTask, withHandler(getUniqueId, () => 'test-id'))
 */
export function withHandler<T extends AnyFn>(
  effect: EffectWithHelpers<T>,
  implementation: T
): { overrides: { [HANDLERS_KEY]: Handlers } };

/**
 * [Advanced] A standalone function to create run options for a single handler.
 * Prefer the `.withHandler()` method attached directly to an effect for a cleaner API.
 */
export function withHandler(
  arg1: EffectWithHelpers<any> | EffectsSuite<any> | string,
  arg2: any,
  arg3?: any
): { overrides: { [HANDLERS_KEY]: Handlers } } {
  // Overload: withHandler(effectsSuite, effectName, implementation)
  if (arg3 !== undefined && typeof arg2 === 'string') {
    const effectName = arg2;
    const implementation = arg3;
    return { overrides: { [HANDLERS_KEY]: { [effectName]: implementation } } };
  }

  // Overload: withHandler<T>(effectName, implementation)
  if (typeof arg1 === 'string') {
    const effectName = arg1;
    const implementation = arg2;
    return { overrides: { [HANDLERS_KEY]: { [effectName]: implementation } } };
  }
  
  // Overload: withHandler(effect, implementation)
  // At this point, arg1 must be an EffectWithHelpers object. We cast it to ensure
  // TypeScript knows about the `.createHandler` method.
  const effect = arg1 as EffectWithHelpers<any>;
  const implementation = arg2;

  // The createHandler method is guaranteed to exist on an effect object and returns
  // a correctly formatted Handlers object. This is the safest way to handle this case.
  const handlerObject = effect.createHandler(implementation);
  return { overrides: { [HANDLERS_KEY]: handlerObject } };
}