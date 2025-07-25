/**
 * @module
 * This module implements the "Effects Handler" pattern, a powerful way to
 * decouple the declaration of side effects (the "what") from their implementation
 * (the "how"). This enables maximum testability and allows for swapping
 * implementations at runtime.
 *
 * ---
 *
 * ### Recommended Usage for New Projects
 *
 * For the best type safety and developer experience, use the `createEffectSuite`
 * factory. It provides a complete, matched set of tools that are type-safe
 * from end to end.
 *
 * For backward compatibility and specific use cases, standalone helpers like
 * `defineEffects`, `createHandlers`, and `withHandlers` are still available.
 * The `createHandlers` and `withHandlers` functions have been enhanced with
 * optional generics to allow for opt-in type safety improvements in existing codebases.
 */

import { getContext, type BaseContext } from './run';

// =================================================================
// Section 1: Core Types, Symbols, and Errors
// =================================================================

/**
 * A unique `Symbol` used as the key for the effects handler map within the context.
 * Using a symbol prevents property name collisions.
 */
export const HANDLERS_KEY = Symbol.for('effectively.handlers');

/** A generic type representing the shape of any function. */
type AnyFn = (...args: any[]) => any;

/** An object type where keys are strings and values are functions. Used as a generic constraint. */
type EffectsSchema = Record<string, AnyFn>;

/**
 * Represents a callable effect function. It is an async-first version of the
 * function signature `T`.
 * @template T The function signature of the effect (e.g., `(msg: string) => void`).
 */
export type Effect<T extends AnyFn> = 
  (...args: Parameters<T>) => Promise<ReturnType<T>>;

/** A generic mapping of effect names to their concrete handler implementations. */
export type Handlers = Record<string, AnyFn>;

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
    super(`Handler for effect "${effectName}" not found. Ensure it's provided to the 'run' call using 'withHandlers()'.`);
    this.name = 'EffectHandlerNotFoundError';
    Object.setPrototypeOf(this, EffectHandlerNotFoundError.prototype);
  }
}

// =================================================================
// Section 2: The Recommended "Effect Suite" Pattern
// =================================================================

/**
 * Creates a complete, type-safe suite for managing a domain of effects.
 *
 * This is the **recommended entry point** for using this library. It takes a single
 * generic argument (a `type` or `interface` defining your effects) and returns
 * a matched set of tools that are pre-configured to work together. This provides
 * end-to-end type safety, virtually eliminating runtime errors from mismatched
 * effect and handler definitions.
 *
 * @template T A `type` or `interface` that defines the effect names and their function signatures.
 * @returns An object containing:
 *  - `effects`: A proxy to use in your tasks (`await effects.someEffect()`).
 *  - `createHandlers`: A factory for creating handler objects guaranteed to match the shape of `T`.
 *  - `withHandlers`: A wrapper to pass your handlers to the `run` function, also type-checked against `T`.
 *
 * @example
 * import { createEffectSuite, defineTask, run } from 'effectively';
 *
 * // 1. Define the contract for your application's effects.
 * type AppEffects = {
 *   log: (message: string) => void;
 *   getUniqueId: () => string;
 * };
 *
 * // 2. Create the suite. All returned tools are now typed to `AppEffects`.
 * const { effects, createHandlers, withHandlers } = createEffectSuite<AppEffects>();
 *
 * // 3. Use the `effects` proxy in your business logic (the "what").
 * const myTask = defineTask(async () => {
 *   const id = await effects.getUniqueId();
 *   await effects.log(`Task executed with ID: ${id}`);
 * });
 *
 * // 4. Implement handlers using the type-safe `createHandlers` (the "how").
 * // TypeScript will error here if a handler is missing or has the wrong signature.
 * const productionHandlers = createHandlers({
 *   log: (message) => console.log(`[PROD] ${message}`),
 *   getUniqueId: () => crypto.randomUUID(),
 * });
 *
 * // 5. Run the task, providing the handlers with the type-safe `withHandlers`.
 * await run(myTask, undefined, withHandlers(productionHandlers));
 */
export function createEffectSuite<T extends EffectsSchema>() {
  const effectCache: Partial<{ [K in keyof T]: Effect<T[K]> }> = {};
  
  const effects = new Proxy({} as { [K in keyof T]: Effect<T[K]> }, {
    get(_target, prop) {
      const effectName = String(prop);
      if (effectCache[effectName as keyof T]) {
        return effectCache[effectName as keyof T];
      }
      const newEffect = defineEffect(effectName) as Effect<T[keyof T]>;
      effectCache[effectName as keyof T] = newEffect;
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

// =================================================================
// Section 3: Low-Level Primitives & Backward Compatibility
// =================================================================
// These functions are preserved for advanced use cases and to ensure
// full backward compatibility for projects using older versions.
// =================================================================

/**
 * [Low-Level] Defines a single, typed "effect" placeholder.
 */
export function defineEffect<T extends AnyFn>(
  effectName: string
): Effect<T> {
  const effectFn = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    const context = getContext<EffectsContext>();
    const handler = context[HANDLERS_KEY]?.[effectName];
    if (typeof handler !== 'function') {
      throw new EffectHandlerNotFoundError(effectName);
    }
    return await handler(...args) as ReturnType<T>;
  };

  Object.defineProperty(effectFn, 'name', { value: effectName, configurable: true });
  return effectFn as Effect<T>;
}

// Overloads for `defineEffects`
export function defineEffects<T extends EffectsSchema>(): { [K in keyof T]: Effect<T[K]> };
export function defineEffects<T extends EffectsSchema>(effectsConfig: T): { [K in keyof T]: Effect<T[K]> };
/**
 * Defines multiple effects at once from a single definition.
 * For new projects, prefer `createEffectSuite`.
 */
export function defineEffects<T extends EffectsSchema>(...args: [T] | []) {
  if (args.length > 0) {
    const effectsConfig = args[0];
    const newEffects = {} as { [K in keyof T]: Effect<T[K]> };
    for (const effectName in effectsConfig) {
      if (Object.prototype.hasOwnProperty.call(effectsConfig, effectName)) {
        newEffects[effectName] = defineEffect<T[typeof effectName]>(effectName);
      }
    }
    return newEffects;
  }
  const effectCache: Partial<{ [K in keyof T]: Effect<T[K]> }> = {};
  return new Proxy({} as { [K in keyof T]: Effect<T[K]> }, {
    get(_target, prop) {
      const effectName = String(prop);
      if (effectCache[effectName as keyof T]) {
        return effectCache[effectName as keyof T];
      }
      const newEffect = defineEffect(effectName) as Effect<T[keyof T]>;
      effectCache[effectName as keyof T] = newEffect;
      return newEffect;
    },
  });
}

// --- `createHandlers` Overloads for Opt-In Safety ---

/**
 * Creates a handlers object, validating it against a provided type contract.
 * @template T The effects contract (e.g., `AppEffects`) to validate against.
 * @param handlers An object of handler implementations.
 */
export function createHandlers<T extends EffectsSchema>(handlers: T): T;
/**
 * Creates a handlers object, inferring its type from the implementation.
 * @param handlers An object of handler implementations.
 */
export function createHandlers(handlers: Handlers): Handlers;
// Implementation for `createHandlers`
export function createHandlers(handlers: Handlers): Handlers {
  return handlers;
}

// --- `withHandlers` Overloads for Opt-In Safety ---

/**
 * Creates run options with handlers, validating them against a provided type contract.
 * @template T The effects contract (e.g., `AppEffects`) to validate against.
 * @param handlers An object of handler implementations that must match `T`.
 * @example
 * // This provides compile-time safety by catching missing/wrong handlers.
 * run(myTask, withHandlers<AppEffects>({ ... }));
 */
export function withHandlers<T extends EffectsSchema>(handlers: T): { overrides: { [HANDLERS_KEY]: T } };
/**
 * Creates run options with handlers without compile-time validation.
 * Ensures backward compatibility for existing code.
 * @param handlers A generic handlers object.
 */
export function withHandlers(handlers: Handlers): { overrides: { [HANDLERS_KEY]: Handlers } };
// Implementation for `withHandlers`
export function withHandlers(handlers: Handlers) {
  return { overrides: { [HANDLERS_KEY]: handlers } };
}