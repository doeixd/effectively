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

import { getContext, type BaseContext, type Scope } from './run';

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
export type Effect<T extends (...args: readonly unknown[]) => unknown> =
  (...args: Parameters<T>) => Promise<ReturnType<T>>;

/**
 * A mapping of effect names to their concrete handler implementations.
 * This object is provided under the `HANDLERS_KEY` symbol in the context.
 */
export type Handlers = Record<string, (...args: unknown[]) => unknown>;

/**
 * The shape a context must have to support the effects pattern. It must satisfy
 * the base context requirement and include the optional handlers property.
 */
export interface EffectsContext extends BaseContext {
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
export function defineEffect<T extends (...args: readonly unknown[]) => unknown>(
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
    return await handler(...args) as ReturnType<T>;
  };

  // Assign a name for better debugging and introspection.
  Object.defineProperty(effectFn, 'name', { value: effectName, configurable: true });

  return effectFn as Effect<T>;
}

// =================================================================
// Section 3: Effect Registry Helpers
// =================================================================

/**
 * A helper function to define multiple effects at once from a type-safe configuration.
 * This is useful when you have many effects to define and want to avoid repetitive calls.
 *
 * @template T A record type mapping effect names to their function signatures.
 * @param effectsConfig A configuration object where keys are effect names and values are their signatures.
 * @returns An object containing all the defined effects, with the same keys as the input.
 *
 * @example
 * ```typescript
 * import { defineEffects } from 'effectively/effects';
 *
 * // Define multiple effects in one go
 * export const effects = defineEffects({
 *   log: (message: string) => void,
 *   getUniqueId: () => string,
 *   readFile: (path: string) => string,
 *   writeFile: (path: string, content: string) => void,
 * });
 *
 * // Use them in tasks
 * const myTask = defineTask(async (input: string) => {
 *   const id = await effects.getUniqueId();
 *   await effects.log(`Processing ${input} with ID: ${id}`);
 *   const content = await effects.readFile('config.json');
 *   // ... etc
 * });
 *
 * // Provide handlers for all effects
 * await run(myTask, 'test', {
 *   overrides: {
 *     [HANDLERS_KEY]: {
 *       log: console.log,
 *       getUniqueId: () => crypto.randomUUID(),
 *       readFile: (path) => fs.readFileSync(path, 'utf8'),
 *       writeFile: (path, content) => fs.writeFileSync(path, content),
 *     }
 *   }
 * });
 * ```
 */
export function defineEffects<T extends Record<string, (...args: readonly unknown[]) => unknown>>(
  _effectsConfig: T
): { [K in keyof T]: Effect<T[K]> } {
  const effects = {} as { [K in keyof T]: Effect<T[K]> };
  
  for (const effectName in _effectsConfig) {
    effects[effectName] = defineEffect<T[typeof effectName]>(effectName);
  }
  
  return effects;
}

/**
 * Creates a handlers object that can be used with the HANDLERS_KEY.
 * This provides type safety when creating handler implementations.
 *
 * @template T A record type mapping effect names to their function signatures.
 * @param handlers An object mapping effect names to their concrete implementations.
 * @returns A handlers object ready to be used with HANDLERS_KEY.
 *
 * @example
 * ```typescript
 * import { createHandlers, HANDLERS_KEY } from 'effectively/effects';
 *
 * // Type-safe handler creation
 * const appHandlers = createHandlers({
 *   log: (message: string) => console.log(message),
 *   getUniqueId: () => crypto.randomUUID(),
 *   readFile: (path: string) => fs.readFileSync(path, 'utf8'),
 * });
 *
 * // Use with run
 * await run(myTask, input, {
 *   overrides: {
 *     [HANDLERS_KEY]: appHandlers
 *   }
 * });
 * ```
 */
export function createHandlers<T extends Record<string, (...args: readonly unknown[]) => unknown>>(
  handlers: { [K in keyof T]: T[K] }
): Handlers {
  return handlers as Handlers;
}

/**
 * Creates run options with handlers, eliminating the need to manually use HANDLERS_KEY.
 * This is the simplest way to provide handlers to a run call.
 *
 * @param handlers A handlers object mapping effect names to implementations
 * @returns Run options object with handlers properly configured
 *
 * @example
 * ```typescript
 * await run(myTask, input, withHandlers({
 *   log: (msg) => console.log(msg),
 *   readFile: (path) => fs.readFileSync(path, 'utf8')
 * }));
 * ```
 */
export function withHandlers(handlers: Handlers): { overrides: Record<string | symbol, unknown> } {
  return { overrides: { [HANDLERS_KEY]: handlers } };
}