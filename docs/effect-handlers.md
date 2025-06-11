# Effect Handlers Guide

The Effect Handlers system in Effectively provides a powerful pattern for creating testable, modular code by separating the **declaration** of side effects from their **implementation**. This allows you to write abstract, composable tasks that can be tested easily and work in different environments.

## Core Concepts

### What are Effect Handlers?

Effect Handlers implement the "Effects Handler" pattern where:

1. **Effects** are abstract declarations of what your code wants to do (e.g., "log a message", "read a file")
2. **Handlers** are concrete implementations of how those effects should be executed
3. **The runtime** connects effects to their handlers dynamically at execution time

This separation provides several benefits:
- **Testability**: Replace real implementations with mocks during testing
- **Modularity**: Swap implementations for different environments (dev, prod, test)
- **Composability**: Mix and match effects without tight coupling

### Basic Usage

```typescript
import { defineEffect, withHandlers } from '@doeixd/effectively/handlers';
import { defineTask, run } from '@doeixd/effectively';

// 1. Define your effects (the "what")
const log = defineEffect<(message: string) => void>('log');
const getUniqueId = defineEffect<() => string>('getUniqueId');

// 2. Use effects in your tasks
const createUser = defineTask(async (name: string) => {
  const id = await getUniqueId();
  await log(`Creating user ${name} with ID: ${id}`);
  return { id, name };
});

// 3. Provide handlers when running (the "how")
const result = await run(createUser, 'Alice', withHandlers({
  log: (message) => console.log(message),
  getUniqueId: () => crypto.randomUUID(),
}));
```

## Defining Effects

### Single Effect Definition

Use `defineEffect` to create individual effects:

```typescript
import { defineEffect } from '@doeixd/effectively/handlers';

// Define an effect with its type signature
const readFile = defineEffect<(path: string) => string>('readFile');
const writeFile = defineEffect<(path: string, content: string) => void>('writeFile');
const httpGet = defineEffect<(url: string) => Promise<string>>('httpGet');

// Effects are callable and return Promises
const content = await readFile('/path/to/file');  // Promise<string>
await writeFile('/path/to/output', content);      // Promise<void>
const response = await httpGet('https://api.example.com'); // Promise<string>
```

### Multiple Effects Definition

For convenience, use `defineEffects` to define multiple effects at once:

```typescript
import { defineEffects } from '@doeixd/effectively/handlers';

// Define multiple effects with a single call
const effects = defineEffects({
  log: (level: 'info' | 'warn' | 'error', message: string) => void,
  readConfig: (key: string) => string | undefined,
  saveState: (key: string, value: any) => void,
  sendNotification: (recipient: string, message: string) => void,
});

// Use the effects object
const processUser = defineTask(async (userId: string) => {
  await effects.log('info', `Processing user ${userId}`);
  const config = await effects.readConfig('processing_mode');
  
  if (config === 'notify') {
    await effects.sendNotification(userId, 'Processing started');
  }
  
  // ... processing logic
  await effects.saveState(`user_${userId}`, { processed: true });
});
```

## Creating Handlers

### Manual Handler Creation

Create handlers manually as plain objects:

```typescript
import { withHandlers } from '@doeixd/effectively/handlers';

const productionHandlers = {
  log: (level: string, message: string) => {
    console.log(`[${level.toUpperCase()}] ${message}`);
  },
  readConfig: (key: string) => process.env[key.toUpperCase()],
  saveState: (key: string, value: any) => {
    // Save to Redis/database
    redis.set(key, JSON.stringify(value));
  },
  sendNotification: (recipient: string, message: string) => {
    // Send via email/SMS service
    notificationService.send(recipient, message);
  },
};

await run(processUser, 'user123', withHandlers(productionHandlers));
```

### Type-Safe Handler Creation

Use `createHandlers` for better type safety:

```typescript
import { createHandlers } from '@doeixd/effectively/handlers';

const handlers = createHandlers({
  log: (level: 'info' | 'warn' | 'error', message: string) => {
    console.log(`[${level.toUpperCase()}] ${message}`);
  },
  readConfig: (key: string): string | undefined => {
    return process.env[key.toUpperCase()];
  },
  // TypeScript will ensure these match your effect signatures
});
```

## Testing with Effect Handlers

Effect handlers make testing incredibly straightforward:

```typescript
import { describe, it, expect, jest } from '@jest/globals';

describe('User Processing', () => {
  it('should log processing start and save state', async () => {
    const mockLog = jest.fn();
    const mockSaveState = jest.fn();
    
    const testHandlers = createHandlers({
      log: mockLog,
      readConfig: () => 'silent', // No notifications in test
      saveState: mockSaveState,
      sendNotification: jest.fn(), // Mock but unused
    });
    
    await run(processUser, 'test-user', withHandlers(testHandlers));
    
    expect(mockLog).toHaveBeenCalledWith('info', 'Processing user test-user');
    expect(mockSaveState).toHaveBeenCalledWith('user_test-user', { processed: true });
  });
  
  it('should send notification when configured', async () => {
    const mockSendNotification = jest.fn();
    
    const testHandlers = createHandlers({
      log: () => {},
      readConfig: (key) => key === 'processing_mode' ? 'notify' : undefined,
      saveState: () => {},
      sendNotification: mockSendNotification,
    });
    
    await run(processUser, 'notify-user', withHandlers(testHandlers));
    
    expect(mockSendNotification).toHaveBeenCalledWith('notify-user', 'Processing started');
  });
});
```

## Advanced Patterns

### Environment-Specific Handlers

Create different handler sets for different environments:

```typescript
// handlers/development.ts
export const developmentHandlers = createHandlers({
  log: (level, message) => console.log(`[DEV:${level}] ${message}`),
  readConfig: (key) => process.env[key] || 'default-dev-value',
  saveState: (key, value) => {
    // Use in-memory store for development
    developmentStore.set(key, value);
  },
  sendNotification: (recipient, message) => {
    console.log(`[MOCK EMAIL] To: ${recipient}, Message: ${message}`);
  },
});

// handlers/production.ts
export const productionHandlers = createHandlers({
  log: (level, message) => logger.log(level, message),
  readConfig: (key) => configService.get(key),
  saveState: (key, value) => database.save(key, value),
  sendNotification: (recipient, message) => emailService.send(recipient, message),
});

// main.ts
const handlers = process.env.NODE_ENV === 'production' 
  ? productionHandlers 
  : developmentHandlers;

await run(myApp, initialData, withHandlers(handlers));
```

### Conditional Handler Logic

Handlers can contain conditional logic:

```typescript
const smartHandlers = createHandlers({
  log: (level, message) => {
    if (process.env.NODE_ENV === 'test') return; // Silent in tests
    if (level === 'error') {
      // Send to error tracking service
      errorTracker.captureException(new Error(message));
    }
    console.log(`[${level}] ${message}`);
  },
  
  saveState: (key, value) => {
    if (process.env.CACHE_ENABLED === 'true') {
      cache.set(key, value, { ttl: 3600 });
    }
    return database.save(key, value);
  },
});
```

### Hierarchical Handler Composition

Combine multiple handler objects:

```typescript
const baseHandlers = createHandlers({
  log: console.log,
  readConfig: (key) => process.env[key],
});

const extendedHandlers = createHandlers({
  ...baseHandlers,
  // Add new handlers
  sendEmail: (to, subject, body) => emailService.send(to, subject, body),
  // Override existing handlers
  log: (level, message) => structuredLogger.log({ level, message, timestamp: Date.now() }),
});
```

### Effect Composition

Effects can call other effects:

```typescript
const effects = defineEffects({
  log: (level: string, message: string) => void,
  getCurrentTime: () => string,
  logWithTimestamp: (level: string, message: string) => void,
});

// This effect uses other effects
const logWithTimestamp = defineEffect<(level: string, message: string) => void>('logWithTimestamp');

// Implementation in handlers
const handlers = createHandlers({
  log: (level, message) => console.log(`[${level}] ${message}`),
  getCurrentTime: () => new Date().toISOString(),
  logWithTimestamp: async (level, message) => {
    const timestamp = await effects.getCurrentTime();
    await effects.log(level, `${timestamp} - ${message}`);
  },
});
```

## Best Practices

### 1. Keep Effects Pure and Focused

Each effect should represent a single, well-defined operation:

```typescript
// Good: Focused, single responsibility
const readFile = defineEffect<(path: string) => string>('readFile');
const parseJson = defineEffect<(json: string) => any>('parseJson');

// Avoid: Doing too much in one effect
const readAndParseFile = defineEffect<(path: string) => any>('readAndParseFile');
```

### 2. Use Descriptive Effect Names

Effect names should clearly describe what they do:

```typescript
// Good: Clear and descriptive
const sendWelcomeEmail = defineEffect<(userId: string) => void>('sendWelcomeEmail');
const getUserPreferences = defineEffect<(userId: string) => UserPrefs>('getUserPreferences');

// Avoid: Vague or generic names
const doStuff = defineEffect<(data: any) => any>('doStuff');
const handler = defineEffect<(input: string) => string>('handler');
```

### 3. Organize Effects by Domain

Group related effects together:

```typescript
// auth-effects.ts
export const authEffects = defineEffects({
  hashPassword: (password: string) => string,
  verifyPassword: (password: string, hash: string) => boolean,
  generateToken: (userId: string) => string,
  validateToken: (token: string) => { userId: string } | null,
});

// storage-effects.ts
export const storageEffects = defineEffects({
  saveUser: (user: User) => void,
  getUser: (id: string) => User | null,
  deleteUser: (id: string) => void,
  listUsers: (filters?: UserFilters) => User[],
});
```

### 4. Provide Type-Safe Interfaces

Use TypeScript generics and interfaces for better type safety:

```typescript
interface LogLevel {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  meta?: Record<string, unknown>;
}

const log = defineEffect<(entry: LogLevel) => void>('log');

// Handler must match the interface
const handlers = createHandlers({
  log: (entry: LogLevel) => {
    console.log(`[${entry.level}] ${entry.message}`, entry.meta);
  },
});
```

### 5. Handle Errors Gracefully

Effects can throw errors, which should be handled appropriately:

```typescript
const readFile = defineEffect<(path: string) => string>('readFile');

const handlers = createHandlers({
  readFile: (path: string) => {
    try {
      return fs.readFileSync(path, 'utf8');
    } catch (error) {
      throw new Error(`Failed to read file ${path}: ${error.message}`);
    }
  },
});

// In your task, handle potential errors
const processFile = defineTask(async (filePath: string) => {
  try {
    const content = await readFile(filePath);
    return processContent(content);
  } catch (error) {
    await log('error', `File processing failed: ${error.message}`);
    throw error;
  }
});
```

## Error Handling

### Effect Handler Not Found

If you call an effect without providing a handler, you'll get an `EffectHandlerNotFoundError`:

```typescript
import { EffectHandlerNotFoundError } from '@doeixd/effectively/handlers';

try {
  await run(taskThatUsesEffects, input); // No handlers provided
} catch (error) {
  if (error instanceof EffectHandlerNotFoundError) {
    console.error(`Missing handler for effect: ${error.effectName}`);
  }
}
```

### Safe Effect Calling

You can check if handlers are available before calling effects:

```typescript
import { getContext } from '@doeixd/effectively';
import { HANDLERS_KEY } from '@doeixd/effectively/handlers';

const conditionalLog = defineTask(async (message: string) => {
  const context = getContext();
  const handlers = context[HANDLERS_KEY];
  
  if (handlers?.log) {
    await log(message);
  } else {
    console.warn('No log handler available, skipping log');
  }
});
```

## Integration with Other Effectively Features

### Using with Error Boundaries

```typescript
import { withErrorBoundary, createErrorHandler } from '@doeixd/effectively';

const resilientTask = withErrorBoundary(
  taskThatUsesEffects,
  createErrorHandler(
    [EffectHandlerNotFoundError, async (error) => {
      console.error(`Missing effect handler: ${error.effectName}`);
      return null; // Fallback value
    }]
  )
);
```

### Using with Workflows

Effects work seamlessly in workflows:

```typescript
const workflow = createWorkflow(
  validateInput,
  fetchUserData,    // Uses effects for API calls
  enrichUserData,   // Uses effects for additional data
  saveResult,       // Uses effects for persistence
  sendNotification  // Uses effects for notifications
);
```

### Using with Do-Notation

```typescript
import { doTask, pure } from '@doeixd/effectively';

const userWorkflow = doTask(function* (userId: string) {
  yield effects.log('info', `Starting workflow for user ${userId}`);
  
  const user = yield fetchUser(userId);
  const profile = yield enrichProfile(user);
  
  yield effects.saveState(`user_${userId}`, profile);
  yield effects.log('info', 'Workflow completed successfully');
  
  return yield pure(profile);
});
```

## Comparison with Other Patterns

### vs. Dependency Injection

Traditional DI injects dependencies at construction time:

```typescript
// Traditional DI
class UserService {
  constructor(
    private logger: Logger,
    private database: Database,
    private emailService: EmailService
  ) {}
  
  async createUser(name: string) {
    this.logger.info(`Creating user ${name}`);
    // ...
  }
}
```

Effect handlers inject behavior at runtime:

```typescript
// Effect handlers
const createUser = defineTask(async (name: string) => {
  await log('info', `Creating user ${name}`);
  // ...
});

// Provide behavior when running
await run(createUser, 'Alice', withHandlers(handlers));
```

Benefits of effect handlers:
- More flexible: can change behavior per execution
- Better for testing: easy to mock individual operations
- Composable: mix and match effects across tasks

### vs. Context-Based Injection

You could use context directly for effects:

```typescript
interface AppContext {
  logger: Logger;
  database: Database;
}

const createUser = defineTask(async (name: string) => {
  const { logger } = getContext<AppContext>();
  logger.info(`Creating user ${name}`);
});
```

Effect handlers provide additional benefits:
- **Type safety**: Effects have explicit signatures
- **Error handling**: Clear errors when handlers are missing
- **Organization**: Effects are self-documenting and centralized
- **Flexibility**: Easy to provide different implementations

## Conclusion

Effect handlers in Effectively provide a powerful pattern for building testable, modular applications. By separating the declaration of side effects from their implementation, you can:

- Write code that's easy to test with mocks
- Swap implementations for different environments
- Compose effects in complex workflows
- Maintain type safety throughout your application

The effect handlers system integrates seamlessly with all other Effectively features, making it a natural choice for building robust, maintainable applications.
