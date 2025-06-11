/**
 * @module
 * The main entry point for the "Effectively" library. This module exports
 * all the core functions and types for building robust, composable, and
 * resilient asynchronous workflows in TypeScript.
 */

// Core execution engine and type definitions
export * from './run';

// Core types
export * from './types';

// Main composition and utility operators (pipe, map, tap, withRetry, etc.)
export * from './utils';
export * from './pipeable';

// Context management
export * from './context';

// Error handling (Result type, withErrorBoundary, createErrorType)
export * from './errors';

// Effects handler pattern for dependency injection
export * from './handlers';

// Explicit Resource Management (bracket, bracketMany, bracketDisposable)
export * from './bracket';

// Advanced, production-grade resilience patterns
export * from './circuit-breaker'; 

// Parallel and concurrent task execution scheduler
export * from './scheduler';

// ---> NEWLY ADDED MODULES <---

// High-level structured concurrency patterns (forkJoin, ift, allTuple)
export * from './structured-concurrency';

// High-level parallel data processing utilities (mapReduce, filter, groupBy)
export * from './data-processing';

// Web Worker and multi-threading integration
export * from './worker';

// Monadic do notation using generator syntax
export * from './do-notation';

// OpenTelemetry integration and observability utilities
export * from './telemetry';