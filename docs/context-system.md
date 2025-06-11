# The Smart Context System

Effectively features a sophisticated, yet simple context system that adapts to how you use it. This guide explains the three types of context functions and when to use each.

## Overview

The context system provides multiple variants of each core function (`defineTask`, `getContext`, `run`, etc.):

1. **Smart Functions** - Adaptive behavior that uses current context or falls back to global
2. **Local-Only Functions** - Strict mode that only works within an active context
3. **Global-Only Functions** - Explicit mode that always uses the global default context
4. **Context-Bound Functions** - Functions returned from `createContext` that are bound to a specific context type

## Smart Functions (Recommended for Most Use Cases)

Smart functions are the default exports and provide the most convenient experience. They automatically detect and use the current context if available, falling back to a global default context when no context is active.

### Available Smart Functions

- `defineTask<V, R>(fn)` - Creates tasks that adapt to any context
- `getContext<C>()` - Gets current context or global default
- `getContextSafe<C>()` - Safe version that returns Result type
- `getContextOrUndefined<C>()` - Never throws, returns undefined if no context
- `run<V, R>(task, value, options?)` - Executes tasks in current or global context
- `provide(overrides, fn)` - Temporarily modifies context

### Usage Examples

```typescript
import { defineTask, getContext, run } from '@doeixd/effectively';

// Works at the top level (uses global context)
const task1 = defineTask(async (input: string) => {
  const context = getContext(); // Gets global default context
  return `Hello ${input}`;
});

await run(task1, 'World'); // Uses global context

// Also works within custom contexts
const { run: customRun } = createContext({ userId: 'user123' });

const task2 = defineTask(async (input: string) => {
  const context = getContext(); // Gets custom context when run in custom context
  return `Hello ${input} from ${(context as any).userId || 'unknown'}`;
});

await customRun(task2, 'World'); // Automatically uses custom context
```

### When to Use Smart Functions

✅ **Use smart functions when:**
- Building applications that may use multiple contexts
- You want convenience and flexibility
- You're starting a new project and want to begin simple
- You want tasks that work in any context

❌ **Avoid smart functions when:**
- You need strict guarantees about which context is being used
- You're building a library that should only work in specific contexts
- You want to enforce that certain code only runs in custom contexts

## Local-Only Functions (Strict Context Requirements)

Local-only functions enforce that you're operating within a specific context. They throw errors if no current context is available, never falling back to global.

### Available Local-Only Functions

- `defineTaskLocal<C, V, R>(fn)` - Creates tasks that require active context
- `getContextLocal<C>()` - Gets current context, throws if none
- `getContextSafeLocal<C>()` - Returns error Result if no context
- `getContextOrUndefinedLocal<C>()` - Returns undefined if no context
- `runLocal<C, V, R>(task, value, options?)` - Executes only in current context
- `provideLocal<C, R>(overrides, fn)` - Modifies only current context

### Usage Examples

```typescript
import { defineTaskLocal, getContextLocal, runLocal } from '@doeixd/effectively';

// This task ONLY works within a context
const strictTask = defineTaskLocal<MyContext, string, string>(async (input) => {
  const context = getContextLocal<MyContext>(); // Throws if no context
  return `Processing ${input} for user ${context.userId}`;
});

// This will throw an error - no context available
try {
  await runLocal(strictTask, 'data'); // ❌ Throws ContextNotFoundError
} catch (error) {
  console.log('Expected error:', error.message);
}

// This works - we're providing a context
const { run: contextRun } = createContext<MyContext>({ userId: 'user123' });
await contextRun(strictTask, 'data'); // ✅ Works fine
```

### When to Use Local-Only Functions

✅ **Use local-only functions when:**
- Building library code that requires specific contexts
- You want to enforce that certain operations only happen in custom contexts
- You need strict guarantees about context availability
- You want to catch context misuse at runtime

❌ **Avoid local-only functions when:**
- You want flexibility to work with or without custom contexts
- You're building application code that should work in any environment
- You want the convenience of global fallback behavior

## Global-Only Functions (Explicit Global Usage)

Global-only functions always use the global default context, regardless of any current context. They provide predictable behavior when you specifically want global context.

### Available Global-Only Functions

- `defineTaskGlobal<V, R>(fn)` - Creates tasks that always use global context
- `getContextGlobal()` - Always gets global default context
- `runGlobal<V, R>(task, value, options?)` - Always executes in global context
- `provideGlobal<R>(overrides, fn)` - Always modifies global context

### Usage Examples

```typescript
import { defineTaskGlobal, getContextGlobal, runGlobal } from '@doeixd/effectively';

// This task ALWAYS uses global context
const globalTask = defineTaskGlobal(async (input: string) => {
  const context = getContextGlobal(); // Always gets global context
  return `Global processing: ${input}`;
});

// Even within a custom context, this uses global
const { run: customRun } = createContext({ userId: 'user123' });

await customRun(async () => {
  // Despite being in custom context, this uses global
  const result = await runGlobal(globalTask, 'data');
  console.log(result); // "Global processing: data"
});
```

### When to Use Global-Only Functions

✅ **Use global-only functions when:**
- You need predictable, consistent behavior regardless of context
- Building utility functions that should work the same everywhere
- You want to explicitly ignore any current context
- You're implementing global services or singleton patterns

❌ **Avoid global-only functions when:**
- You want context-aware behavior
- You're building code that should adapt to different environments
- You want to take advantage of dependency injection

## Context-Bound Functions (from createContext)

Context-bound functions are returned when you call `createContext<C>()`. These functions are **local and type-safe** - they're permanently bound to the specific context type you defined.

### Characteristics of Context-Bound Functions

- **Local**: Only work with the specific context type `C` passed to `createContext<C>()`
- **Type-Safe**: Full TypeScript support with exact context type
- **Context-Specific**: Tasks created will always expect the defined context type
- **No Fallback**: Don't use global context - they're tied to their own context system

### Available Context-Bound Functions

When you call `createContext<MyContext>()`, you get:

- `defineTask<V, R>(fn)` - Creates tasks bound to `MyContext`
- `getContext()` - Gets the current `MyContext` (no fallback)
- `getContextSafe()` - Safe version returning `Result<MyContext, Error>`
- `getContextOrUndefined()` - Returns `MyContext | undefined`
- `run<V, R>(task, value, options?)` - Executes tasks in `MyContext`
- `provide<R>(overrides, fn)` - Modifies `MyContext` temporarily

### Usage Examples

```typescript
import { createContext, type Scope } from '@doeixd/effectively';

interface MyAppContext {
  scope: Scope;
  userId: string;
  apiUrl: string;
  database: Database;
}

// Create context-bound functions
const { defineTask, getContext, run } = createContext<MyAppContext>({
  userId: 'user123',
  apiUrl: 'https://api.example.com',
  database: myDatabase
});

// This defineTask is bound to MyAppContext specifically
const fetchUserData = defineTask(async (userId: string) => {
  const context = getContext(); // TypeScript knows this is MyAppContext
  // Full type safety - context.userId, context.apiUrl, context.database all known
  const response = await fetch(`${context.apiUrl}/users/${userId}`);
  return response.json();
});

// This run only works with MyAppContext
const userData = await run(fetchUserData, 'user456');
```

### Type Safety Comparison

```typescript
// Context-bound (most type-safe)
const { defineTask: boundDefineTask } = createContext<MyContext>({ /* ... */ });
const task1 = boundDefineTask(async (input) => {
  const ctx = getContext(); // TypeScript knows this is exactly MyContext
  return ctx.userId; // ✅ Full intellisense and type checking
});

// Smart function with generic (type-safe when specified)
const task2 = defineTask<MyContext, string, string>(async (input) => {
  const ctx = getContext<MyContext>(); // Need to specify type manually
  return ctx.userId; // ✅ Type-safe but requires manual typing
});

// Smart function without generic (less type-safe)
const task3 = defineTask(async (input) => {
  const ctx = getContext(); // TypeScript doesn't know the exact type
  return (ctx as any).userId; // ⚠️ Requires casting or type guards
});
```

### When to Use Context-Bound Functions

✅ **Use context-bound functions when:**
- You have a well-defined application context with specific types
- You want maximum type safety and intellisense
- You're building a complete application with consistent context needs
- You want to ensure all code uses the same context structure
- You prefer explicit context creation over implicit behavior

❌ **Avoid context-bound functions when:**
- You want tasks that work across multiple different contexts
- You're building library code that should be context-agnostic
- You want the flexibility of smart context detection
- You're prototyping and want minimal setup

## The Global Default Context

The global default context is automatically created the first time any smart or global function is used. It's stored in `globalThis` and provides a minimal context with just the required `scope` property.

### Global Context Interface

```typescript
interface DefaultGlobalContext {
  scope: Scope; // Required by all contexts
}
```

### Extending the Global Context

You can extend the global context using `provideGlobal`:

```typescript
import { provideGlobal, defineTask, getContext } from '@doeixd/effectively';

// Add properties to global context
await provideGlobal({ apiUrl: 'https://api.example.com' }, async () => {
  const task = defineTask(async (input: string) => {
    const context = getContext();
    return `Data from ${(context as any).apiUrl}: ${input}`;
  });
  
  return run(task, 'hello');
});
```

## Migration Guide

### From Simple Usage

If you're currently using basic `defineTask` and `getContext`:

```typescript
// Before (still works!)
import { defineTask, getContext, run } from '@doeixd/effectively';

// After (same code, enhanced behavior)
import { defineTask, getContext, run } from '@doeixd/effectively';
// No changes needed - smart functions provide the same experience with more flexibility
```

### From createContext Usage

If you're currently creating contexts explicitly:

```typescript
// Before
const { defineTask, getContext, run } = createContext({ apiUrl: 'https://api.com' });

// After - you have choices:

// Option 1: Keep using createContext (recommended for custom contexts)
const { defineTask, getContext, run } = createContext({ apiUrl: 'https://api.com' });

// Option 2: Use smart functions that work in any context
import { defineTask, getContext, run } from '@doeixd/effectively';

// Option 3: Use local-only functions for strict context requirements
import { defineTaskLocal, getContextLocal, runLocal } from '@doeixd/effectively';
```

## Best Practices

### 1. Start Simple, Add Complexity When Needed

Begin with smart functions and global context, then add custom contexts as your application grows:

```typescript
// Phase 1: Simple start
import { defineTask, run } from '@doeixd/effectively';

// Phase 2: Add custom context when needed
const { run: customRun } = createContext({ database: myDb });

// Phase 3: Mix as needed - smart functions work in both contexts
```

### 2. Use Type Parameters for Safety

Always use type parameters when you know the context type:

```typescript
// Good - type safe
const context = getContext<MyContext>();

// Less good - requires casting
const context = getContext() as MyContext;
```

### 3. Choose the Right Function Variant

Use this decision tree:

```
Do you have a well-defined, application-specific context?
├─ Yes → Do you want maximum type safety?
│   ├─ Yes → Use context-bound functions (createContext<MyContext>()) ✅ Best type safety
│   └─ No → Use smart functions with generics (defineTask<MyContext>())
└─ No → Do you need strict context requirements?
    ├─ Yes → Use local-only functions (defineTaskLocal, getContextLocal, etc.)
    └─ No
       └─ Do you need predictable global behavior?
          ├─ Yes → Use global-only functions (defineTaskGlobal, getContextGlobal, etc.)
          └─ No → Use smart functions (defineTask, getContext, etc.) ✅ Most flexible
```

### 4. Library vs Application Code

```typescript
// Library code - be explicit about context requirements
export const libraryFunction = defineTaskLocal<RequiredContext, Input, Output>(
  async (input) => {
    const context = getContextLocal<RequiredContext>();
    // Library logic here
  }
);

// Application code - several good options:

// Option 1: Context-bound (best type safety)
const { defineTask, getContext } = createContext<AppContext>({ /* ... */ });
const appFunction1 = defineTask(async (input) => {
  const context = getContext(); // Full type safety for AppContext
  // Application logic here
});

// Option 2: Smart functions with generics (flexible + type safe)
const appFunction2 = defineTask<AppContext, Input, Output>(async (input) => {
  const context = getContext<AppContext>();
  // Application logic here
});

// Option 3: Smart functions (most flexible)
const appFunction3 = defineTask(async (input) => {
  const context = getContext(); // Works in any context
  // Application logic here
});
```

## Troubleshooting

### ContextNotFoundError with Local Functions

```typescript
// ❌ This will throw
const task = defineTaskLocal(async (input) => {
  return getContextLocal(); // No context available
});

await runLocal(task, 'input'); // Throws ContextNotFoundError

// ✅ Fix: Ensure you're in a context
const { run } = createContext({});
await run(task, 'input'); // Works
```

### Unexpected Context Behavior

```typescript
// If you're getting unexpected context, check which function you're using:

const context1 = getContext(); // Smart: current context or global fallback
const context2 = getContextLocal(); // Local: current context only, throws if none  
const context3 = getContextGlobal(); // Global: always global context

// For debugging, check what context you actually have:
const context = getContextOrUndefined();
if (context) {
  console.log('Current context:', context);
} else {
  console.log('No current context, will use global');
}
```

### Type Safety Issues

```typescript
// ❌ Not type safe
const context = getContext();
context.someProperty; // May not exist

// ✅ Type safe options:

// Option 1: Use generics
const context = getContext<MyContext>();
context.someProperty; // TypeScript knows this exists

// Option 2: Use type guards
const context = getContext();
if ('someProperty' in context) {
  context.someProperty; // Safe to access
}

// Option 3: Use safe access
const context = getContext();
const property = (context as any).someProperty || 'default';
```

## Complete Function Comparison

Here's a comprehensive comparison of all context function variants:

| Function Type | Source | Behavior | Type Safety | Use Case |
|---------------|--------|----------|-------------|----------|
| **Context-Bound** | `createContext<C>()` | Local to specific context `C` | ✅ **Excellent** - Bound to `C` | App development with defined context |
| **Smart** | `import { defineTask }` | Current context or global fallback | ⚠️ **Good** - With generics `<C>` | Flexible app/library development |
| **Local-Only** | `import { defineTaskLocal }` | Current context only, throws if none | ✅ **Excellent** - With generics `<C>` | Strict library development |
| **Global-Only** | `import { defineTaskGlobal }` | Always global context | ✅ **Good** - With `DefaultGlobalContext` | Utilities, global services |

### Quick Reference

```typescript
// Context-Bound: Maximum type safety, specific context
const { defineTask } = createContext<MyContext>({ /* ... */ });
const task1 = defineTask(async (input) => { /* fully typed */ });

// Smart: Flexible, works anywhere
import { defineTask } from '@doeixd/effectively';
const task2 = defineTask<MyContext, Input, Output>(async (input) => { /* typed */ });
const task3 = defineTask(async (input) => { /* flexible */ });

// Local-Only: Strict context requirements
import { defineTaskLocal } from '@doeixd/effectively';
const task4 = defineTaskLocal<MyContext, Input, Output>(async (input) => { /* strict */ });

// Global-Only: Always global
import { defineTaskGlobal } from '@doeixd/effectively';
const task5 = defineTaskGlobal(async (input) => { /* global */ });
```

This smart context system provides maximum flexibility while maintaining type safety and predictable behavior. Choose the right variant for your use case, and enjoy the progressive enhancement capabilities!
