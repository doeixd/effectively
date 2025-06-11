// Re-export context management functions for backward compatibility
export {
  createContext,
  mergeContexts,
  validateContext,
  requireContextProperties,
  useContextProperty,
  withContextEnhancement,
  createInjectionToken,
  inject,
  injectOptional,
  // Smart context functions
  defineTask,
  getContext,
  getContextSafe,
  getContextOrUndefined,
  run,
  provide,
  // Local-only context functions
  defineTaskLocal,
  getContextLocal,
  getContextSafeLocal,
  getContextOrUndefinedLocal,
  runLocal,
  provideLocal,
  // Global-only context functions
  defineTaskGlobal,
  getContextGlobal,
  runGlobal,
  provideGlobal,
  type ContextTools,
  type BaseContext,
  type ContextSchema,
  type InjectionToken,
  type MergeContexts
} from './run';
