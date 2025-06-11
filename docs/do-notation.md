# Do Notation with Generator Syntax

The **do notation** module provides Haskell-inspired monadic composition using JavaScript/TypeScript generator functions. This allows you to write async workflows in a more imperative, readable style while maintaining functional purity and composability.

## Overview

Traditional monadic composition can become deeply nested and hard to follow:

```typescript
// Traditional approach - hard to read
const workflow = getUserById(userId)
  .then(user => getProfileById(user.profileId)
    .then(profile => getSettingsById(user.settingsId)
      .then(settings => ({ user, profile, settings }))
    )
  );
```

With do notation, the same logic becomes linear and readable:

```typescript
// With do notation - much cleaner
const workflow = doTask(function* (userId: string) {
  const user = yield getUserById(userId);
  const profile = yield getProfileById(user.profileId);
  const settings = yield getSettingsById(user.settingsId);
  
  return { user, profile, settings };
});
```

## Basic Usage

### Creating a Do Block

Use `doTask` to create a Task that executes generator-based monadic composition:

```typescript
import { doTask, pure } from 'effectively';

const myWorkflow = doTask(function* (input: string) {
  // Yield monadic values to unwrap them
  const result1 = yield someAsyncTask(input);
  const result2 = yield anotherTask(result1);
  
  // Return the final result
  return result2;
});
```

### Supported Monadic Values

The do notation can unwrap several types of monadic values:

```typescript
const workflow = doTask(function* () {
  // Tasks from the effectively library
  const user = yield getUser('123');
  
  // Regular Promises
  const data = yield fetch('/api/data').then(r => r.json());
  
  // Result types (neverthrow)
  const parsed = yield parseJson(jsonString); // Result<Data, Error>
  
  // Plain values (automatically lifted)
  const plain = yield pure(42);
  
  return { user, data, parsed, plain };
});
```

## Context-Specific Do Notation

For better type inference and context handling, create context-specific do notation:

```typescript
interface MyContext extends BaseContext {
  db: Database;
  logger: Logger;
  config: Config;
}

const { doTask: myDoTask, doBlock } = createDoNotation<MyContext>();

// Now with proper context typing
const workflow = myDoTask(function* (userId: string) {
  const user = yield getUser(userId); // Uses MyContext
  const posts = yield getUserPosts(user.id);
  return { user, posts };
});
```

## Advanced Features

### Error Handling

Errors in yielded monadic values are automatically propagated and can be caught:

```typescript
const workflow = doTask(function* (userId: string) {
  try {
    const user = yield getUser(userId);
    const profile = yield getProfile(user.id);
    return { user, profile };
  } catch (error) {
    // Handle errors from any yielded operation
    console.error('Workflow failed:', error);
    throw error;
  }
});
```

### Conditional Execution

Use `doWhen` and `doUnless` for conditional monadic execution:

```typescript
import { doWhen, doUnless } from 'effectively';

const workflow = doTask(function* (userId: string) {
  const user = yield getUser(userId);
  
  // Conditional execution
  const adminData = yield doWhen(
    user.isAdmin,
    () => getAdminData(userId),
    () => pure(null)
  );
  
  // Execute only if condition is false
  yield doUnless(user.isActive, () => activateUser(userId));
  
  return { user, adminData };
});
```

### Sequential Operations

Use `sequence` to execute multiple monadic operations and collect results:

```typescript
const workflow = doTask(function* (userIds: string[]) {
  // Execute getUser for each ID sequentially
  const users = yield sequence(userIds.map(id => getUser(id)));
  return users;
});
```

### Iteration

Use `forEach` to iterate over arrays with monadic operations:

```typescript
const workflow = doTask(function* (userIds: string[]) {
  yield forEach(userIds, function* (userId) {
    const user = yield getUser(userId);
    yield logUserActivity(user);
    yield updateUserStatus(user.id, 'processed');
  });
});
```

## Complete Example

Here's a comprehensive example showing various features:

```typescript
import { 
  doTask, 
  createDoNotation, 
  doWhen, 
  sequence, 
  pure 
} from 'effectively';

interface AppContext extends BaseContext {
  db: Database;
  cache: Cache;
  logger: Logger;
}

const { doTask: appDoTask } = createDoNotation<AppContext>();

// Define some tasks
const getUser = defineTask(async (id: string) => {
  const ctx = getContext<AppContext>();
  return ctx.db.users.findById(id);
});

const getCachedProfile = defineTask(async (userId: string) => {
  const ctx = getContext<AppContext>();
  const cached = await ctx.cache.get(`profile:${userId}`);
  if (cached) return cached;
  
  const profile = await ctx.db.profiles.findByUserId(userId);
  await ctx.cache.set(`profile:${userId}`, profile);
  return profile;
});

const updateUserLastSeen = defineTask(async (userId: string) => {
  const ctx = getContext<AppContext>();
  return ctx.db.users.update(userId, { lastSeen: new Date() });
});

// Main workflow using do notation
const getUserWithProfile = appDoTask(function* (userId: string) {
  const ctx = getContext<AppContext>();
  ctx.logger.info('Starting user lookup', { userId });
  
  try {
    // Get user data
    const user = yield getUser(userId);
    
    if (!user) {
      throw new Error(`User ${userId} not found`);
    }
    
    // Conditionally get profile based on user settings
    const profile = yield doWhen(
      user.profileEnabled,
      () => getCachedProfile(userId),
      () => pure(null)
    );
    
    // Update last seen for active users
    yield doWhen(
      user.isActive,
      () => updateUserLastSeen(userId),
      () => pure(undefined)
    );
    
    // If user has friends, get their basic info
    const friends = user.friendIds.length > 0 
      ? yield sequence(user.friendIds.slice(0, 5).map(id => getUser(id)))
      : [];
    
    ctx.logger.info('User lookup completed', { userId, hasFriends: friends.length > 0 });
    
    return {
      user,
      profile,
      friends: friends.map(f => ({ id: f.id, name: f.name }))
    };
    
  } catch (error) {
    ctx.logger.error('User lookup failed', { userId, error });
    throw error;
  }
});

// Usage
async function main() {
  const { run } = createContext<AppContext>({
    db: new Database(),
    cache: new Cache(),
    logger: console
  });
  
  const result = await run(getUserWithProfile, 'user123');
  console.log(result);
}
```

## Benefits

1. **Readability**: Linear, imperative-style code that's easy to follow
2. **Error Handling**: Automatic error propagation with standard try/catch
3. **Type Safety**: Full TypeScript support with proper type inference
4. **Composability**: Works seamlessly with existing Task-based workflows
5. **Performance**: No additional overhead - compiles to efficient async/await code
6. **Flexibility**: Supports any monadic type (Tasks, Promises, Results, etc.)

## Best Practices

1. **Use descriptive generator function names** for better debugging
2. **Keep do blocks focused** - break large workflows into smaller, composable pieces
3. **Handle errors appropriately** - use try/catch for expected error conditions
4. **Leverage context-specific do notation** for better type safety
5. **Combine with other patterns** - do notation works well with circuit breakers, retries, etc.

## Comparison with Other Patterns

| Pattern | Pros | Cons |
|---------|------|------|
| Promise chains | Native JS/TS | Deeply nested, hard to read |
| Async/await | Familiar syntax | Doesn't work well with monadic types |
| Manual composition | Full control | Verbose, error-prone |
| **Do notation** | **Readable, composable, type-safe** | **Requires understanding generators** |

The do notation provides the best of both worlds: the readability of imperative code with the power and safety of functional composition.
