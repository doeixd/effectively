/**
 * @module
 * This module implements the "Effects Handler" pattern, a powerful way to
 * decouple the declaration of side effects (the "what") from their implementation
 * (the "how"). This enables maximum testability and allows for swapping
 * implementations (e.g., for production vs. testing) at runtime.
 *
 * The pattern involves two parts:
 * 1. **Defining an Effect:** Use `defineEffect` from this module to create a
 *    typed, callable placeholder for an action (e.g., `log`, `getUniqueId`).
 * 2. **Providing a Handler:** In your `run` call, provide a concrete
 *    implementation for the effect. Handlers are provided in an object under
 *    the special `HANDLERS_KEY` symbol.
 */

import { getContext, type Scope } from './run'; // Assuming core types are in './run'

// =================================================================
// Section 1: Core Symbol and Type Definitions
// =================================================================

/**
 * A unique `Symbol` used as the key for the effects handler map within the context.
 * Using a symbol prevents property name collisions with user-defined context properties.
 */
export const HANDLERS_KEY = Symbol.for('effectively.handlers');

/**
 * Represents a callable effect function created by `defineEffect`.
 * It is an async-first version of the function signature `T`.
 *
 * @template T The function signature of the effect (e.g., `(msg: string) => void`).
 */
export type Effect<T extends (...args: any[]) => any> =
  (...args: Parameters<T>) => Promise<ReturnType<T>>;

/**
 * A mapping of effect names to their concrete handler implementations.
 * This object is provided under the `HANDLERS_KEY` symbol in the context.
 */
export type Handlers = Record<string, (...args: any[]) => any>;

/**
 * The shape a context must have to support the effects pattern. It must satisfy
 * the base `{ scope: Scope }` requirement of the system and include the optional
 * handlers property.
 */
export interface EffectsContext {
  scope: Scope;
  [HANDLERS_KEY]?: Handlers;
}

/**
 * An error thrown when an effect is called but no corresponding handler
 * has been provided in the context.
 */
export class EffectHandlerNotFoundError extends Error {
  constructor(public readonly effectName: string) {
    super(`Handler for effect "${effectName}" not found. Ensure it's provided under the HANDLERS_KEY symbol in the context.`);
    this.name = 'EffectHandlerNotFoundError';
    Object.setPrototypeOf(this, EffectHandlerNotFoundError.prototype);
  }
}

// =================================================================
// Section 2: Core Effect Utility
// =================================================================

/**
 * Defines a new, typed "effect". An effect is a placeholder for an action
 * (like logging, generating a unique ID, or reading a file) whose implementation
 * is provided at runtime.
 *
 * This function returns a directly callable, async function that, when executed,
 * will look up and run its corresponding handler from the context.
 *
 * @template T The function signature of the effect.
 * @param effectName A unique string identifier for this effect.
 * @returns A callable `Effect` function.
 *
 * @example
 * ```typescript
 * // src/app-effects.ts
 * import { defineEffect } from 'effectively/effects';
 *
 * // Define the "what" - the abstract actions our app can perform.
 * export const log = defineEffect<(message: string) => void>('log');
 * export const getUniqueId = defineEffect<() => string>('getUniqueId');
 *
 * // --- In a task file ---
 * import { log, getUniqueId } from './app-effects';
 * import { defineTask } from 'effectively';
 *
 * export const createUser = defineTask(async (name: string) => {
 *   const id = await getUniqueId(); // Declaration of intent, not implementation.
 *   await log(`Creating user ${name} with ID: ${id}`);
 *   return { id, name };
 * });
 *
 * // --- In your main application file ---
 * import { createUser } from './tasks';
 * import { HANDLERS_KEY } from 'effectively/effects';
 *
 * // Provide the "how" - the concrete implementations.
 * await run(createUser, 'Alice', {
 *   overrides: {
 *     [HANDLERS_KEY]: {
 *       log: (message) => console.log(message),
 *       getUniqueId: () => crypto.randomUUID(),
 *     }
 *   }
 * });
 *
 * // --- In a test file using `provide` ---
 * import { createUser } from './tasks';
 *
 * test('createUser should use a predictable ID', async () => {
 *   const handlers = {
 *     log: () => {}, // a no-op logger for tests
 *     getUniqueId: () => 'test-id-123',
 *   };
 *
 *   // Provide a mock implementation for testing.
 *   const user = await provide({ [HANDLERS_KEY]: handlers }, () => run(createUser, 'Bob'));
 *   expect(user.id).toBe('test-id-123');
 * });
 * ```
 */
export function defineEffect<T extends (...args: any[]) => any>(
  effectName: string
): Effect<T> {
  const effectFn = async (...args: Parameters<T>): Promise<ReturnType<T>> => {
    // This is the core mechanism: the effect finds its implementation
    // from the context provided by `run`, stored under the HANDLERS_KEY symbol.
    const context = getContext<EffectsContext>();
    const handler = context[HANDLERS_KEY]?.[effectName];

    if (typeof handler !== 'function') {
      throw new EffectHandlerNotFoundError(effectName);
    }

    // The handler can be sync or async, so we always await it to normalize.
    return await handler(...args);
  };

  // Assign a name for better debugging and introspection.
  Object.defineProperty(effectFn, 'name', { value: effectName, configurable: true });

  return effectFn as Effect<T>;
}