# The 16-Line Pattern That Eliminates Dependency Passing

Learn how a tiny runtime using JavaScript generators can transform how you structure applications

<br />

## Building Intuition: The Restaurant Analogy

Imagine two restaurants:

**Restaurant A (Dependency Passing)**
- Every tool is passed down the chain: Manager → Head Chef → Line Cook → Prep Cook.
- If the Prep Cook needs a salt shaker, the Manager, Head Chef, and Line Cook all have to handle the salt shaker just to pass it along.
- Adding a new station with new tools requires updating everyone's passing duties.
- Each person is burdened with handling supplies they don't need, just to pass them along.

**Restaurant B (Our Pattern)**
- The kitchen has a Quartermaster who manages all supplies.
- When a cook is hired, they simply state their role: "I'm the new Prep Cook."
- The Quartermaster gives them exactly what a Prep Cook needs: a knife, a cutting board, and a salt shaker.
- Cooks focus on cooking, not on the supply chain. New tools for a role? Just tell the Quartermaster.

This is the shift we're making in code.

<br />

## The Problem: Dependency Passing Hell

Let's see this in code you've probably written:

```javascript
// ❌ The problem: Every function needs ALL dependencies passed through
async function saveUserHandler(req, res, db, logger, cache, emailService, validator) {
  const { userId, data } = req.body;
  
  // This function only uses logger, but needs all deps to pass them down
  logger.info(`Request to save user ${userId}`);
  
  const result = await updateUserProfile(userId, data, db, logger, cache, emailService, validator);
  res.json(result);
}

async function updateUserProfile(userId, data, db, logger, cache, emailService, validator) {
  // This function doesn't use emailService, but must pass it along
  logger.info(`Updating profile for ${userId}`);
  
  const user = await loadAndValidateUser(userId, db, logger, cache, validator);
  const updatedUser = await saveUser(user, data, db, logger, emailService);
  
  return updatedUser;
}

async function loadAndValidateUser(userId, db, logger, cache, validator) {
  // More dependency passing...
  const cached = await cache.get(`user:${userId}`);
  if (cached) {
    logger.info('Cache hit');
    return cached;
  }
  
  const user = await db.findUser(userId);
  if (!validator.isValidUser(user)) {
    throw new Error('Invalid user');
  }
  
  await cache.set(`user:${userId}`, user);
  return user;
}

async function saveUser(user, data, db, logger, emailService) {
  // Finally using emailService, 3 levels deep!
  const updated = await db.updateUser(user.id, data);
  await emailService.sendUpdateEmail(user.email, updated);
  logger.info('User saved and email sent');
  return updated;
}
```

**What is Dependency Passing?**
This pattern of passing dependencies through multiple function layers is known as "dependency passing" or "parameter threading". In React, it's called "prop drilling", but the problem exists in all JavaScript code - functions receiving dependencies they don't use, just to pass them to other functions.

**Visualizing the Pain:**

```
Dependency Passing Visualization:

saveHandler ━━━━━━━━━━━━━━━━━━━━━━━━━━┓
    ↓ (db, logger, cache, email, ...) ┃
updateProfile ━━━━━━━━━━━━━━━━━━━━━━━━┫
    ↓ (db, logger, cache, email, ...) ┃ Height = Pain
loadUser ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┫
    ↓ (db, logger, cache, email, ...) ┃
validateUser ━━━━━━━━━━━━━━━━━━━━━━━━━┫
    ↓ (db, logger, cache, email, ...) ┃
saveUser ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛
    (finally uses email!)
```

<br />

## The Mind-Shift: From PUSH to PULL

Here's the key insight that changes everything:

```javascript
// The traditional way: "How do I get dependencies TO my function?"
// Structure dictates dependencies - PUSH model
function doWork(logger, db, cache, validator, emailer, metric, queue) { 
  // Must accept ALL dependencies, even if we only use logger
  logger.info('Working...');
}

// The new way: "How can my function GET dependencies when needed?"
// Logic dictates dependencies - PULL model
function* doWork() {
  // Only get what you need, when you need it!
  const logger = yield getLogger();
  logger.info('Working...');
  
  if (someCondition) {
    const db = yield getDatabase();  // Pull conditionally
    // ...
  }
  // Never needed cache, validator, emailer, metric, or queue? Never pulled them!
}
```

**The Pattern Visualized:**

```
Generator Pattern:

saveHandler ●
            │
updateProfile ● ←──── runtime ←──── context
            │           ↑           (all deps)
loadUser    ● ←─────────┘
            │
validateUser ● ←────────┘
            │
saveUser    ● ←─────────┘
```

<br />

## "Why Not Just..." - Addressing the Alternatives

You might be thinking of alternatives. Let's address them:

### Why not just use a global object?

```javascript
// Global approach
global.db.findUser(123); 

// Problems:
// ❌ Can't test without modifying globals
// ❌ No dependency tracking - what does this function use?
// ❌ Breaks with multiple contexts (e.g., multi-tenant)
// ❌ Hidden coupling - dependencies aren't explicit
```

### Why not use classes and constructor injection?

```javascript
class UserService {
  constructor(db, logger, cache, validator, emailer) {
    // Back to dependency passing in the constructor!
    this.db = db;
    this.logger = logger;
    // ...
  }
}
// ❌ Still need to pass all dependencies
// ❌ Instances become stateful
// ❌ Hard to compose operations
```

### Why not use React Context or similar?

```javascript
const UserContext = React.createContext();
// ❌ Only works in React
// ❌ Still requires provider setup
// ❌ Can't compose workflows
// ❌ Limited to component tree
```

Our solution achieves the same goals with just 16 lines of vanilla JavaScript.

<br />

## Understanding Generators: The Pause/Resume Mechanism

Before we build our solution, let's understand generators:

```javascript
function* simpleExample() {
  console.log('1. Generator starts');
  
  const value = yield 'Hello';  // PAUSE here, send 'Hello' out
  
  console.log('2. Generator resumes with:', value);
  
  const value2 = yield 'World'; // PAUSE again, send 'World' out
  
  console.log('3. Generator resumes with:', value2);
  return 'Done';
}

// Let's manually control the generator
const gen = simpleExample();

console.log('Starting...');
const result1 = gen.next();      // Run until first yield
console.log('Got:', result1);     // { value: 'Hello', done: false }

const result2 = gen.next('Hi!');  // Resume with 'Hi!'
console.log('Got:', result2);     // { value: 'World', done: false }

const result3 = gen.next('Bye!'); // Resume with 'Bye!'
console.log('Got:', result3);     // { value: 'Done', done: true }
```

**Output:**
```
Starting...
1. Generator starts
Got: { value: 'Hello', done: false }
2. Generator resumes with: Hi!
Got: { value: 'World', done: false }
3. Generator resumes with: Bye!
Got: { value: 'Done', done: true }
```

### 🤔 Check Your Understanding #1

Before continuing, make sure you can answer:
1. Why do generators allow us to "pause" execution?
2. What happens when we call `yield`?
3. How do we send values back into a generator?

<details>
<summary>Answers</summary>

1. Generators pause at each `yield`, returning control to the caller
2. `yield` pauses the generator and sends out a value
3. We send values back using `gen.next(value)` - the value becomes the result of the yield

</details>

<br />

## Building the Pattern Step by Step

### Step 1: The Operation Description Pattern

Let's build up to our pattern progressively:

```javascript
// Building up to the pattern:

// Step 1: We need to call this operation
context.db.findUser(123)

// Step 2: But we don't have context yet! Wrap in a function
() => context.db.findUser(123)

// Step 3: But context isn't in scope! Accept as parameter
(context) => context.db.findUser(123)

// Step 4: But we need to capture the ID! Wrap again
(id) => (context) => context.db.findUser(id)

// Final pattern: Parameter capture + Context injection
const getUser = (id) => (context) => context.db.findUser(id);
```

This creates a **description** of an operation without executing it:

```javascript
// Operation descriptions - these DON'T execute anything
const getUser = (id) => (context) => context.db.findUser(id);
const log = (msg) => (context) => context.logger.info(msg);
const validate = (data) => (context) => context.validator.validate(data);
```

### Step 2: Building the Runtime - Basic Version

Let's build our runtime step by step to understand how it works:

```javascript
// Version 1: Manual execution (no loop)
async function simpleRuntime(generatorFn, context) {
  const gen = generatorFn();
  
  // Start the generator
  let step1 = await gen.next();
  console.log('Generator yielded:', step1.value);
  
  // Execute what it asked for
  let result1 = await step1.value(context);
  
  // Give it back
  let step2 = await gen.next(result1);
  console.log('Generator yielded:', step2.value);
  
  // This gets repetitive... we need a loop!
}

// Version 2: Add the loop
async function runtimeWithLoop(generatorFn, context) {
  const gen = generatorFn();
  let result = await gen.next();
  
  while (!result.done) {
    // Execute the operation
    const value = await result.value(context);
    // Continue the generator
    result = await gen.next(value);
  }
  
  return result.value;
}

// Version 3: Add error handling (our final version)
function runtime(generatorFunction) {
  // Return executor that will inject dependencies
  return async function execute(context) {
    // Create new generator instance
    const generator = generatorFunction();
    // Run generator until first yield
    let result = await generator.next();
    
    // Process each yield until done
    while (!result.done) {
      // Get the operation function that was yielded
      const operation = result.value;
      try {
        // Execute operation with context, get result
        const operationResult = await operation(context);
        // Resume generator with result
        result = await generator.next(operationResult);
      } catch (error) {
        // Forward errors into generator
        result = await generator.throw(error);
      }
    }
    
    // Return final value
    return result.value;
  };
}
```

### 🤔 Check Your Understanding #2

1. Why do we need a loop in our runtime?
2. What does `operation(context)` do?
3. Why do we have a try/catch block?

<details>
<summary>Answers</summary>

1. Generators can yield multiple times, we need to handle each yield
2. It executes the operation description with the actual context
3. To forward errors from operations back to the generator

</details>

<br />

## Common Mistakes and How to Avoid Them

Let's learn from common errors:

```javascript
// ❌ MISTAKE 1: Yielding values instead of operations
async function* wrong() {
  const user = yield db.getUser(1); // ❌ This executes immediately!
  // db is not defined, this will crash
}

// ✅ CORRECT: Yield operation descriptions
async function* correct() {
  const user = yield (ctx) => ctx.db.getUser(1); // ✅ Executes later
  // Or better, use an operation creator:
  const user2 = yield getUser(1); // ✅ Much cleaner
}

// ❌ MISTAKE 2: Forgetting to return from operation
const badOperation = (id) => (ctx) => {
  ctx.db.getUser(id); // ❌ Forgot to return!
};

// ✅ CORRECT: Always return the promise
const goodOperation = (id) => (ctx) => {
  return ctx.db.getUser(id); // ✅
};
// Or use arrow function's implicit return:
const bestOperation = (id) => (ctx) => ctx.db.getUser(id); // ✅

// ❌ MISTAKE 3: Trying to store context
async function* contextMistake() {
  const ctx = yield getContext(); // ❌ Don't do this!
  // Context should only exist in the runtime
}

// ✅ CORRECT: Let operations access context
async function* contextCorrect() {
  const user = yield getUser(123); // ✅ Runtime handles context
}

// ❌ MISTAKE 4: Yielding non-functions
async function* yieldMistake() {
  yield 'Hello'; // ❌ Runtime expects functions!
}

// ✅ CORRECT: Always yield operations
async function* yieldCorrect() {
  yield log('Hello'); // ✅ log returns a function
}
```

<br />

## Complete Working Example

Let's see it all together:

```javascript
// ============================================
// 1. THE RUNTIME (copy this to use the pattern)
// ============================================
function runtime(generatorFunction) {
  return async function execute(context) {
    const generator = generatorFunction();
    let result = await generator.next();
    
    while (!result.done) {
      const operation = result.value;
      
      try {
        const operationResult = await operation(context);
        result = await generator.next(operationResult);
      } catch (error) {
        result = await generator.throw(error);
      }
    }
    
    return result.value;
  };
}

// ============================================
// 2. OPERATION DEFINITIONS
// ============================================
const log = (message) => 
  (context) => context.logger.info(message);

const getUser = (id) => 
  (context) => context.db.findUser(id);

const updateUser = (id, data) => 
  (context) => context.db.updateUser(id, data);

const sendEmail = (to, subject, body) =>
  (context) => context.email.send(to, subject, body);

const cacheGet = (key) => 
  (context) => context.cache.get(key);

const cacheSet = (key, value) => 
  (context) => context.cache.set(key, value);

// ============================================
// 3. BUSINESS LOGIC (using generators)
// ============================================
async function* updateUserProfile(userId, newData) {
  yield log(`Starting update for user ${userId}`);
  
  // Check cache first
  const cacheKey = `user:${userId}`;
  let user = yield cacheGet(cacheKey);
  
  if (!user) {
    yield log('Cache miss - loading from database');
    user = yield getUser(userId);
    
    if (!user) {
      throw new Error('User not found');
    }
    
    // Cache for next time
    yield cacheSet(cacheKey, user);
  } else {
    yield log('Cache hit');
  }
  
  // Update the user
  const updated = { ...user, ...newData, updatedAt: new Date() };
  yield updateUser(userId, updated);
  yield cacheSet(cacheKey, updated);
  
  // Send notification
  yield sendEmail(
    user.email,
    'Profile Updated',
    `Hi ${updated.name}, your profile was updated.`
  );
  
  yield log('Update completed successfully');
  return updated;
}

// ============================================
// 4. USAGE
// ============================================
async function main() {
  // Create the context with real implementations
  const context = {
    logger: {
      info: (msg) => console.log(`[LOG] ${msg}`)
    },
    db: {
      findUser: async (id) => {
        console.log(`[DB] Finding user ${id}`);
        return { id, name: 'John Doe', email: 'john@example.com' };
      },
      updateUser: async (id, data) => {
        console.log(`[DB] Updating user ${id}`);
        return data;
      }
    },
    email: {
      send: async (to, subject, body) => {
        console.log(`[EMAIL] To: ${to}, Subject: ${subject}`);
      }
    },
    cache: (() => {
      const storage = new Map();
      return {
        get: async (key) => {
          console.log(`[CACHE] Getting ${key}`);
          return storage.get(key);
        },
        set: async (key, value) => {
          console.log(`[CACHE] Setting ${key}`);
          storage.set(key, value);
        }
      };
    })()
  };
  
  // Create executable function
  const runUpdate = runtime(() => updateUserProfile(123, { name: 'Jane Doe' }));
  
  // Execute with our context
  const result = await runUpdate(context);
  console.log('\n[RESULT]', result);
}

main();
```

<br />

## Side-by-Side Comparison

Let's see the difference clearly:

```javascript
// ❌ Traditional: 7 parameters, dependency passing
async function createUserTraditional(
  name, email, db, logger, validator, emailer, cache
) {
  logger.info('Creating user');
  if (!validator.isValidEmail(email)) {
    logger.error('Invalid email');
    throw new Error('Invalid email');
  }
  const user = await db.createUser({ name, email });
  await cache.set(`user:${user.id}`, user);
  await emailer.sendWelcome(email);
  logger.info('User created');
  return user;
}

// ✅ Generator: 2 parameters, clear intent
async function* createUserGenerator(name, email) {
  yield log('Creating user');
  const isValid = yield validateEmail(email);
  if (!isValid) {
    yield logError('Invalid email');
    throw new Error('Invalid email');
  }
  const user = yield createUser({ name, email });
  yield cacheUser(user);
  yield sendWelcomeEmail(email);
  yield log('User created');
  return user;
}

// Result: 71% fewer parameters, 100% clearer intent
```

<br />

## Error Handling: Complete Understanding

Let's deeply understand how errors flow through the system:

```javascript
// Example 1: Generator handles the error
async function* safeWorkflow() {
  try {
    yield log('Attempting risky operation');
    const user = yield getUser(999); // This might throw
    return user;
  } catch (error) {
    yield log(`Error caught: ${error.message}`);
    return null; // Generator handles it gracefully
  }
}

// Example 2: Generator doesn't catch - error propagates
async function* unsafeWorkflow() {
  const user = yield getUser(999); // If this throws...
  return user; // Never reached
}

// Error flow visualization:
// 1. getUser(999) throws in context.db.findUser
// 2. Runtime catches in its try/catch
// 3. Runtime calls generator.throw(error)
// 4. If generator has try/catch: error is caught there
// 5. If not: error propagates to runtime caller

// Example 3: Cleanup on error
async function* workflowWithCleanup() {
  yield log('Starting transaction');
  const transaction = yield beginTransaction();
  
  try {
    const user = yield createUser({ name: 'Test' });
    const profile = yield createProfile(user.id);
    yield commitTransaction(transaction);
    return { user, profile };
  } catch (error) {
    yield log('Error occurred, rolling back');
    yield rollbackTransaction(transaction);
    throw error; // Re-throw after cleanup
  }
}
```

<br />

## Exercise: Convert This Code

Here's a real function that suffers from dependency passing. Try converting it yourself:

```javascript
// ❌ Traditional approach - lots of dependencies
async function processOrder(
  customerId, 
  items, 
  db, 
  logger, 
  inventory, 
  payment, 
  email, 
  metrics
) {
  logger.info(`Creating order for customer ${customerId}`);
  metrics.increment('orders.started');
  
  const customer = await db.findCustomer(customerId);
  if (!customer) {
    logger.error('Customer not found');
    throw new Error('Customer not found');
  }
  
  for (const item of items) {
    const available = await inventory.check(item.productId, item.quantity);
    if (!available) {
      logger.error(`Product ${item.productId} out of stock`);
      throw new Error('Out of stock');
    }
  }
  
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const paymentResult = await payment.charge(customer.paymentMethodId, total);
  
  const order = await db.createOrder({
    customerId,
    items,
    total,
    paymentId: paymentResult.id
  });
  
  await email.sendOrderConfirmation(customer.email, order);
  metrics.increment('orders.completed');
  logger.info(`Order ${order.id} created successfully`);
  
  return order;
}
```

<details>
<summary>✅ Solution: Using the generator pattern</summary>

```javascript
// First, create the operations
const log = (msg) => (ctx) => ctx.logger.info(msg);
const logError = (msg) => (ctx) => ctx.logger.error(msg);
const findCustomer = (id) => (ctx) => ctx.db.findCustomer(id);
const checkInventory = (productId, quantity) => 
  (ctx) => ctx.inventory.check(productId, quantity);
const chargePayment = (methodId, amount) => 
  (ctx) => ctx.payment.charge(methodId, amount);
const createOrder = (data) => (ctx) => ctx.db.createOrder(data);
const sendOrderEmail = (email, order) => 
  (ctx) => ctx.email.sendOrderConfirmation(email, order);
const incrementMetric = (name) => (ctx) => ctx.metrics.increment(name);

// Then, the generator workflow
async function* processOrder(customerId, items) {
  yield log(`Creating order for customer ${customerId}`);
  yield incrementMetric('orders.started');
  
  const customer = yield findCustomer(customerId);
  if (!customer) {
    yield logError('Customer not found');
    throw new Error('Customer not found');
  }
  
  for (const item of items) {
    const available = yield checkInventory(item.productId, item.quantity);
    if (!available) {
      yield logError(`Product ${item.productId} out of stock`);
      throw new Error('Out of stock');
    }
  }
  
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const paymentResult = yield chargePayment(customer.paymentMethodId, total);
  
  const order = yield createOrder({
    customerId,
    items,
    total,
    paymentId: paymentResult.id
  });
  
  yield sendOrderEmail(customer.email, order);
  yield incrementMetric('orders.completed');
  yield log(`Order ${order.id} created successfully`);
  
  return order;
}
```

Notice how the generator version:
- Takes only 2 parameters instead of 8
- Doesn't need to know about dependencies
- Is easier to read and follow
- Can be tested with simple mocks

</details>

<br />

### Making Sense of It: How This Connects to What You Know

This pattern isn't as strange as it looks. It’s just a clever mix of ideas you've probably already seen.

#### Like Express Middleware

Both patterns pass control. But `yield` keeps your logic clean by avoiding the need to pass a messy `req` object everywhere.

```javascript
// Express middleware passes control
app.use((req, res, next) => {
  console.log('Logging');
  next(); // Pass control to next middleware
});

// Our pattern is similar
async function* workflow() {
  yield log('Logging');        // Pass control to runtime
  const user = yield getUser(); // Pass control to runtime
  return user;
}
```

#### Like Async/Await

It's the same "pause and resume" mechanic. `await` pauses for **time**; `yield` pauses for a **dependency**.

```javascript
// async/await: pause for TIME (waiting for I/O)
async function fetchUser() {
  const user = await fetch('/api/user'); // Pause for network
  return user;
}

// generators: pause for DEPENDENCIES (waiting for context)
async function* fetchUser() {
  const user = yield getUser(); // Pause for dependency
  return user;
}
```

#### Like a DI Container

You get the main benefit of a big Dependency Injection framework—decoupled code—without any of the complexity.

```javascript
// Traditional DI container (like Angular)
@Injectable()
class UserService {
  constructor(private db: Database) {}
}

// Our pattern - same concept, no framework
async function* userService() {
  const db = yield getDatabase();
}
```

It avoids Node-only features like `AsyncLocalStorage`, it's explicit instead of magical, and it’s easy to type-check and debug.
<br />

## Real-World Case Study: Redux-Saga

Redux-Saga, used by millions, implements this exact pattern:

```javascript
// Redux-Saga code
function* watchUserLogin() {
  while (true) {
    const action = yield take('USER_LOGIN');        // Pause for action
    const user = yield call(api.login, action.payload); // Pause for API
    yield put({ type: 'LOGIN_SUCCESS', user });     // Pause for dispatch
  }
}

// Our pattern - identical concept
async function* watchUserLogin() {
  while (true) {
    const action = yield waitForAction('USER_LOGIN');
    const user = yield callApi('/login', action.payload);
    yield dispatch({ type: 'LOGIN_SUCCESS', user });
  }
}
```

The pattern you're learning powers production systems handling millions of requests.

<br />

## Gradual Migration Guide

You don't need to rewrite everything at once. Here's how to migrate gradually:

### Step 1: Start with Leaf Functions

```javascript
// Before: Leaf function with dependencies
async function sendNotification(userId, message, db, emailService) {
  const user = await db.getUser(userId);
  await emailService.send(user.email, message);
}

// After: Convert to generator
async function* sendNotification(userId, message) {
  const user = yield getUser(userId);
  yield sendEmail(user.email, message);
}
```

### Step 2: Create a Hybrid Wrapper

```javascript
// Wrapper that works both ways
function sendNotification(userIdOrContext, message, db, emailService) {
  // New way: single context argument
  if (arguments.length === 1 && typeof userIdOrContext === 'object') {
    const context = userId;
    return runtime(function* () {
      const user = yield getUser(context.userId);
      yield sendEmail(user.email, context.message);
    })(context);
  }
  
  // Old way: multiple dependencies
  return (async () => {
    const user = await db.getUser(userId);
    await emailService.send(user.email, message);
  })();
}
```

### Step 3: Update Callers One by One

```javascript
// Old caller
await sendNotification(123, 'Hello', db, emailService);

// New caller
await sendNotification({
  userId: 123,
  message: 'Hello',
  // context goes here
});
```

### Step 4: Remove Old Code Path

Once all callers are updated, remove the old code path and fully embrace the pattern.

<br />

## Why This Works: Inversion of Control

This pattern implements a fundamental principle called "Inversion of Control" (IoC):

**Traditional Control Flow:**
```
Your Code → Calls → Dependencies
(You control when/how dependencies are called)
```

**Inverted Control Flow:**
```
Your Code → Describes → What It Needs
Runtime → Provides → Dependencies
(Runtime controls when/how dependencies are provided)
```

This is the same principle behind:
- Dependency Injection containers (Spring, Angular)
- React hooks (`useContext`, `useState`)
- Middleware systems (Express, Koa)
- Effect systems (Effect-TS, ZIO)

But implemented in just 16 lines of vanilla JavaScript!

<br />

## Testing: Now It's Trivial

Testing becomes incredibly simple:

```javascript
test('updateUserProfile updates user correctly', async () => {
  // Create test context - only mock what you use!
  const mockUser = { id: 1, name: 'Old Name' };
  const testContext = {
    logger: { info: jest.fn() },
    db: {
      findUser: jest.fn().mockResolvedValue(mockUser),
      updateUser: jest.fn().mockResolvedValue({ ...mockUser, name: 'New Name' })
    },
    cache: { 
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn() 
    },
    email: { 
      send: jest.fn() 
    }
  };
  
  // Run workflow
  const runUpdate = runtime(() => updateUserProfile(1, { name: 'New Name' }));
  const result = await runUpdate(testContext);
  
  // Assert
  expect(testContext.db.findUser).toHaveBeenCalledWith(1);
  expect(result.name).toBe('New Name');
  expect(testContext.email.send).toHaveBeenCalled();
});
```

<br />

## TypeScript

The pattern works beautifully with TypeScript, but getting proper type inference requires understanding one quirk of generators. Let's build up to a fully type-safe solution, step by step.

### Step 1: The Problem We're Solving

Without proper typing, TypeScript can't help us catch errors:

```typescript
// ❌ PROBLEM: No type information
async function* updateUserWorkflow(userId) {
  const user = yield getUser(userId);
  
  // TypeScript thinks 'user' is 'any' - can't catch these errors:
  console.log(user.nmae);           // ❌ Typo!
  console.log(user.address.street); // ❌ Property might not exist
  
  return user;
}
```

### Step 2: Adding Basic Types

Let's add types to our operations:

```typescript
// Define your context and domain types
interface AppContext {
  db: {
    findUser(id: number): Promise<User | null>;
    updateUser(id: number, data: Partial<User>): Promise<User>;
  };
  logger: {
    info(message: string): void;
  };
}

interface User {
  id: number;
  name: string;
  email: string;
}

// Type for operations
type Operation<T> = (context: AppContext) => Promise<T>;

// Typed operations
const getUser = (id: number): Operation<User | null> => 
  (ctx) => ctx.db.findUser(id);

const log = (message: string): Operation<void> =>
  (ctx) => ctx.logger.info(message);
```

### Step 3: The Simple Solution - Type Assertions

TypeScript loses track of types through `yield`, but we can fix this with type assertions:

```typescript
// ✅ SOLUTION: Tell TypeScript what type comes back
async function* updateUserWorkflow(userId: number) {
  yield log('Starting update');
  
  // Add a type assertion after yield
  const user = (yield getUser(userId)) as User | null;
  //    ^--- TypeScript now knows the type! ✅
  
  if (!user) {
    throw new Error('User not found');
  }
  
  // Full type safety and autocomplete!
  console.log(user.name); // ✅ TypeScript helps us here
  
  const updated = (yield updateUser(userId, { 
    name: 'Jane' 
  })) as User;
  
  return updated;
}
```

### Step 4: Type-Safe Runtime

Finally, let's add types to our runtime. This ensures type safety all the way through:

```typescript
// Generic workflow type
// - First param: what we yield (operations)
// - Second param: what we return at the end
// - Third param: what comes back from yields (we use any)
type Workflow<T> = AsyncGenerator<Operation<any>, T, any>;

// Type-safe runtime with full generic support
export function runtime<TArgs extends any[], TReturn>(
  generatorFunction: (...args: TArgs) => Workflow<TReturn>
) {
  // Return an executor function that:
  // 1. Takes the context and any workflow arguments
  // 2. Returns a Promise of the workflow's return type
  return async function execute(
    context: AppContext, 
    ...args: TArgs
  ): Promise<TReturn> {
    const generator = generatorFunction(...args);
    let result = await generator.next();

    while (!result.done) {
      const operation = result.value as Operation<any>;
      
      try {
        const operationResult = await operation(context);
        result = await generator.next(operationResult);
      } catch (error) {
        result = await generator.throw(error);
      }
    }

    return result.value;
  };
}

// Usage - everything is fully typed!
const updateUser = runtime(updateUserWorkflow);
// updateUser is typed as: (context: AppContext, userId: number) => Promise<User>

const user = await updateUser(context, 123);
// user is typed as: User ✅
```

That's it! With simple type assertions, you get full type safety. Your IDE will provide autocomplete, catch typos, and ensure type correctness throughout your workflows. However, that's not the full or ideal story to achieving type safty.

### Want Even Better? Use yield* for Automatic Type Inference

There's a clever way to avoid type assertions entirely using `yield*` delegation. Here's how it works:

### Understanding yield vs yield*

```typescript
// yield: Pauses and sends out a value
function* example1() {
  const result = yield 'hello';
  // TypeScript doesn't know what 'result' is
}

// yield*: Delegates to another generator
function* inner() {
  yield 'hello';
  return 42; // This return value matters!
}

function* example2() {
  const result = yield* inner();
  // TypeScript DOES know result is 42!
}
```

The key insight: `yield*` **runs another generator to completion** and gives you its return value. TypeScript can track this!

### The Magic $ Helper

We can use this to create a tiny helper that preserves types:

```typescript
// A tiny generator that yields our operation and returns the result
function* $(operation: Operation<any>) {
  // This generator:
  // 1. Yields the operation (for the runtime to execute)
  // 2. Returns whatever gets passed back
  return yield operation;
}

// Overloaded signature for perfect type inference
function $<T>(operation: Operation<T>): Generator<Operation<T>, T, T>;
function $(operation: Operation<any>) {
  return (function* () {
    return yield operation;
  })();
}
```

### Using the $ Helper

Now your workflows need NO type assertions:

```typescript
// ✅ PERFECT: Full type inference, no assertions!
async function* updateUserWorkflow(userId: number) {
  // yield* runs the $ generator and gets its RETURN value
  const user = yield* $(getUser(userId));
  //    ^--- ✅ TypeScript knows: User | null
  
  if (!user) {
    throw new Error('User not found');
  }
  
  // Perfect type inference all the way down
  console.log(user.name);  // ✅ Full autocomplete
  console.log(user.email); // ✅ Type safe
  
  const updated = yield* $(updateUser(userId, {
    name: 'Jane Doe'
  }));
  //    ^--- ✅ TypeScript knows: User
  
  return updated;
}
```

### Why Does This Work?

Let's trace through what happens:

```typescript
// Step by step:
const user = yield* $(getUser(userId));

// 1. $(getUser(userId)) creates a generator
// 2. yield* runs that generator
// 3. The generator yields getUser(userId) - runtime executes it
// 4. Runtime passes back the result (e.g., a User)
// 5. The generator returns that result
// 6. yield* gives us that return value
// 7. TypeScript tracked it all the way through!
```

Visual representation:

```typescript
// With plain yield - TypeScript loses track:
workflow → yield operation → ??? → any

// With yield* $ - TypeScript follows the path:
workflow → yield* → $ generator → yield operation → return result → typed result!
```

### Can We Remove Even the $ Helper?

Technically, yes! If we restructure how operations work:

```typescript
// Instead of operations being plain functions...
const getUser = (id: number): Operation<User | null> => 
  (ctx) => ctx.db.findUser(id);

// We could make operations themselves generators:
function* getUser(id: number): Generator<
  (ctx: AppContext) => AppContext,  // Yield to get context
  User | null,                       // Return user
  AppContext                         // Receive context
> {
  // This yields a function that returns context (identity function)
  const ctx = yield ((c: AppContext) => c);
  
  // Now we have context and can return the result
  return ctx.db.findUser(id);
}

// Runtime would need to handle this new operation type
async function* workflow(userId: number) {
  // Direct delegation - no helper needed!
  const user = yield* getUser(userId);
  //    ^--- TypeScript infers: User | null
  
  if (!user) throw new Error('Not found');
  
  return user;
}
```

But this approach has downsides:
- Operations become more complex
- Runtime needs modification
- Harder to understand

The `$` helper is a better balance - just 4 lines for perfect type inference!
  
### Deeper Dive: Removing the `$` Helper by Restructuring Operations

The ultimate goal is to achieve perfect type inference with the cleanest possible syntax in our business logic. We want this:

```typescript
// The ideal syntax
const user = yield* getUser(123); // No helpers, no type assertions
// TypeScript should know user is of type `User | null`
```

To understand how to get there, let's first revisit *why* we needed the `$` helper in the first place.

#### The Core Problem: TypeScript and `yield`

The fundamental issue is that TypeScript cannot trace the type of a value across a standard `yield` expression.

```typescript
// When TypeScript sees this:
const myValue = yield someOperation;

// It thinks:
// 1. The `someOperation` value is being sent OUT of the generator.
// 2. At some later time, the runtime will call `generator.next(someExternalValue)`.
// 3. The `someExternalValue` will then be assigned to `myValue`.
//
// TypeScript has no way to statically connect the type of `someOperation`
// to the type of `someExternalValue` that will arrive later. It gives up
// and assigns the type `any` to `myValue`.
```

The `yield*` keyword is different. It's a language feature for *delegating* to another generator. TypeScript understands this delegation.

```typescript
// When TypeScript sees this:
const myValue = yield* anotherGenerator();

// It thinks:
// 1. I'm going to run `anotherGenerator` to completion.
// 2. The final `return` value from `anotherGenerator` will be assigned to `myValue`.
// 3. I can look at the signature of `anotherGenerator` to find its return type!
```

The `$ helper` was a clever trick. It was a tiny generator that wrapped our simple `Operation` function, allowing us to use `yield*` and leverage its type-tracking ability.

#### The "Helper-less" Insight: Make the Operation Itself a Generator

If `yield*` requires a generator to delegate to, the most direct way to eliminate the helper is to **make the operation itself a generator.**

Instead of this:
`getUser` is a function that **returns** an `Operation`.

```typescript
// Old way: A factory for operations
const getUser = (id: number): Operation<User | null> => 
  (ctx) => ctx.db.findUser(id);
```

We change it to this:
`getUser` **is** a generator.

```typescript
// New way: The operation IS a generator
function* getUser(id: number): Generator<..., User | null, ...> {
  // ... logic ...
}
```

Now our workflow can delegate directly to it: `yield* getUser(123)`. But this raises a new, critical question.

#### The New Challenge: How Does the Generator Operation Get the Context?

Our original `Operation` was a simple function that *received* the context: `(ctx) => ...`.

Our new `getUser` generator is now running "inside" the `yield*` expression. It doesn't automatically have access to the `context` that lives in the runtime. So, how does it get it?

It has to *ask for it*.

And how does a generator ask for something from the outside world? **By yielding a value.**

This is the most crucial part of the pattern. The generator operation must perform a two-step dance:
1.  **Yield a special request** that tells the runtime, "Please give me the context object."
2.  **Wait** for the runtime to send the context back via `.next(context)`.

#### The Mechanism: The "Context Request" Signal

We need to design a "signal" that the generator can yield. The simplest signal is a function that the runtime can execute with the context. What's the most direct function to get the context itself? The **identity function**: `(context) => context`.

Let's trace the complete flow:

**Step 1: The Generator Operation (`getUser`)**

We define `getUser` as a generator that performs this dance.

```typescript
// The restructured generator operation
function* getUser(id: number): Generator<
  (ctx: AppContext) => AppContext,  // 1. I will YIELD a function that takes context and returns context.
  Promise<User | null>,              // 2. I will RETURN a Promise that resolves to a User.
  AppContext                         // 3. I EXPECT to receive the AppContext back via .next().
> {
  // The first thing I do is ask for the context.
  // I yield the "context request" signal (the identity function).
  const ctx = yield (c: AppContext) => c;
  
  // The runtime will send the context back, and it gets assigned to `ctx`.
  // Now I have the context! I can perform my real work.
  // I return the promise from the database call.
  return ctx.db.findUser(id);
}
```

**Step 2: The Workflow (`workflow`)**

The workflow code is now beautifully clean.

```typescript
async function* workflow(userId: number) {
  // `yield*` delegates to the `getUser` generator.
  // It handles the entire two-step "context request" dance internally.
  // The final `return` value from `getUser` (the Promise) is returned by `yield*`.
  const userPromise = yield* getUser(userId);
  const user = await userPromise;
  //  ^--- We need this await because `getUser` returns a promise.
  
  // Or more concisely:
  const user = await (yield* getUser(userId));

  if (!user) throw new Error('Not found');
  
  return user;
}
```
*Note: The `await` is required here because the generator operation `returns` a `Promise`, and `yield*` gives us that promise. This is a bit less elegant than the `$ helper` approach where the runtime handles the `await` for us.*

**Step 3: The Runtime (The Catch!)**

Our original 16-line runtime is no longer sufficient. It only knows how to handle one type of yielded value: an `Operation` like `(ctx) => ctx.db.findUser(...)`. It doesn't understand our new "context request" signal `(ctx) => ctx`.

**The runtime must be modified** to distinguish between these two types of requests.

```typescript
// A conceptual modification to the runtime's loop
while (!result.done) {
  const yieldedValue = result.value;

  // We need a way to know if this is a context request
  if (isAContextRequest(yieldedValue)) { 
    // If it is, don't execute it as a long operation.
    // Just give the generator the context back immediately.
    result = await generator.next(context);
  } else {
    // Otherwise, it's a normal operation.
    // Execute it, await the result, and pass it back.
    const operationResult = await yieldedValue(context);
    result = await generator.next(operationResult);
  }
}
```
This modification breaks the beautiful simplicity of the original runtime.

### Where the Type Safety Comes From

The type safety in this helper-less approach is **100% powered by the `yield*` keyword and TypeScript's understanding of generator function signatures.**

1.  **The Contract:** When you write `function* getUser(...): Generator<..., Promise<User | null>, ...>`, you are creating a strongly-typed contract. You're telling TypeScript, "No matter what happens inside this generator, its final `return` value will be of type `Promise<User | null>`."

2.  **The Delegation:** When the workflow executes `yield* getUser(userId)`, TypeScript sees this and says:
    *   "Aha, `yield*`! I'm delegating to `getUser`."
    *   "Let me check the signature of `getUser`."
    *   "I see its declared return type is `Promise<User | null>`."
    *   "Therefore, the result of this entire `yield*` expression must be `Promise<User | null>`."

The type information flows directly from the generator operation's definition to the variable in the workflow, all because `yield*` acts as a type-safe bridge. This is fundamentally different from a plain `yield`, which breaks the chain of type inference.

### Summary: The Final Trade-Off

Let's lay out the pros and cons clearly.

**Benefits of the Helper-less Approach:**

*   **Cleanest Workflow Syntax:** The business logic (`yield* getUser(userId)`) is as clean as it can possibly be, with no helpers or assertions.

**Downsides of the Helper-less Approach:**

*   **Complex Operations:** Every single operation must be converted from a simple, pure function into a more complex generator that does the "context request" dance. This adds boilerplate and cognitive overhead to every operation.
*   **Modified Runtime:** You lose the elegant, universal 16-line runtime. Your runtime now needs special-case logic to handle different kinds of yielded values.
*   **Harder to Understand:** The "magic" is now distributed. A developer needs to understand both the structure of generator operations *and* the special logic in the runtime. The cause-and-effect relationship is less direct.
*   **Awkward `await (yield* ...)` syntax:** The need to manually `await` the result of the `yield*` expression is less ergonomic.

<!--
### Complete Example with $ Helper

```typescript
// The $ helper - just 4 lines!
function $<T>(operation: Operation<T>): Generator<Operation<T>, T, T>;
function $(operation: Operation<any>) {
  return (function* () { return yield operation; })();
}

// Your workflows are now beautiful AND type-safe
async function* createUserWorkflow(
  userData: { name: string; email: string }
): AsyncGenerator<Operation<any>, User, any> {
  // Log with no return value
  yield* $(log(`Creating user ${userData.email}`));
  
  // Check if exists - TypeScript knows it's User | null
  const existing = yield* $(getUser(userData.email));
  
  if (existing) {
    throw new Error('User already exists');
  }
  
  // Create user - TypeScript knows it's User
  const user = yield* $(createUser(userData));
  
  // Send welcome email
  yield* $(sendEmail(user.email, 'Welcome!'));
  
  yield* $(log(`Created user ${user.id}`));
  
  // TypeScript ensures we return a User
  return user;
}
```

-->

### Which Approach Should You Use?

**Use type assertions if:**
- You want to keep things simple
- You don't mind the manual assertions
- Your team is still learning the pattern

```typescript
const user = (yield getUser(id)) as User | null;
```

**Use the $ helper if:**
- You want perfect type inference
- You prefer cleaner code
- You're comfortable with `yield*`

```typescript
const user = yield* $(getUser(id));
```

Both approaches give you full type safety. The helper approach is more elegant but requires understanding `yield*` delegation. Choose what works best for your team.


### The Bottom Line

With TypeScript, our 16-line pattern becomes even more powerful. Whether you use simple type assertions or the advanced `yield*` approach, you get:

- 🎯 **Compile-time safety** - Catch errors before runtime
- 🚀 **Perfect autocomplete** - Your IDE knows every property
- 🔧 **Refactoring confidence** - Change types and TypeScript guides you
- 📚 **Self-documenting code** - Types are your documentation

The pattern that eliminates dependency passing also eliminates type uncertainty. That's the power of good design - it works beautifully at every level.

<br />

## Composing Workflows

Real applications need to compose smaller workflows:

```javascript
// Helper to run sub-workflows
const runWorkflow = (workflowGenerator) => async (context) => {
  const execute = runtime(workflowGenerator);
  return execute(context);
};

// Compose workflows
async function* createUserWithProfile(userData, profileData) {
  yield log('Creating user account');
  
  // Run sub-workflow
  const user = yield runWorkflow(function* () {
    yield log('Validating user data');
    const isValid = yield validateUserData(userData);
    if (!isValid) throw new Error('Invalid user data');
    
    const newUser = yield createUser(userData);
    yield sendWelcomeEmail(newUser.email);
    return newUser;
  });
  
  // Run another sub-workflow
  const profile = yield runWorkflow(function* () {
    yield log('Creating user profile');
    const newProfile = yield createProfile(user.id, profileData);
    yield indexProfileForSearch(newProfile);
    return newProfile;
  });
  
  yield log('User and profile created');
  return { user, profile };
}
```

### 🤔 Check Your Understanding #3

1. What's the difference between `yield getUser(1)` and `yield runWorkflow(...)`?
2. Why do we need the `runWorkflow` helper?
3. Can workflows call other workflows recursively?

<details>
<summary>Answers</summary>

1. `getUser(1)` yields an operation, `runWorkflow(...)` yields a workflow executor
2. To execute sub-generators within our main generator
3. Yes! Workflows can call other workflows, enabling full composition

</details>

<br />

## When to Use This Pattern

**✅ Use it when:**
- You have complex business workflows with many dependencies
- You're tired of dependency passing through multiple layers
- You want highly testable code
- You need to swap implementations (test vs production)
- You're building multi-step processes
- You want clean separation of concerns

**❌ Don't use it when:**
- You have simple, flat code structure
- Your team isn't comfortable with generators
- You're building a library (generators aren't tree-shakeable)
- You need to support very old browsers

<br />

## Your Next Steps

1. **Copy the 16-line runtime** from this article
2. **Convert one function** in your codebase that has dependency passing
3. **Create your first operations** - start with logging
4. **Build your operation library** for your domain
5. **Share your experience** - what worked? what didn't?

Here's a starter template:

```javascript
// runtime.js - The 16-line runtime
export function runtime(generatorFunction) {
  return async function execute(context) {
    const generator = generatorFunction();
    let result = await generator.next();
    
    while (!result.done) {
      const operation = result.value;
      try {
        const operationResult = await operation(context);
        result = await generator.next(operationResult);
      } catch (error) {
        result = await generator.throw(error);
      }
    }
    
    return result.value;
  };
}

// operations.js - Your operation library
export const log = (msg) => (ctx) => ctx.logger.info(msg);
export const getUser = (id) => (ctx) => ctx.db.users.findById(id);
export const createUser = (data) => (ctx) => ctx.db.users.create(data);
// Add more as needed...

// workflows/user.js - Your business logic
import { log, getUser, createUser } from '../operations.js';

export async function* createUserWorkflow(userData) {
  yield log('Creating new user');
  
  const existingUser = yield getUser(userData.email);
  if (existingUser) {
    throw new Error('User already exists');
  }
  
  const user = yield createUser(userData);
  yield log(`User ${user.id} created`);
  
  return user;
}

// app.js - Wire it together
import { runtime } from './runtime.js';
import { createUserWorkflow } from './workflows/user.js';

const context = {
  logger: console,
  db: {
    users: {
      findById: async (id) => {/* your implementation */},
      create: async (data) => {/* your implementation */}
    }
  }
};

const createUser = runtime(() => 
  createUserWorkflow({ email: 'test@example.com', name: 'Test' })
);

const user = await createUser(context);
```

<br />

## Conclusion

In just 16 lines of runtime code, we've built a powerful pattern that eliminates entire categories of problems. The beauty is in its simplicity: generators pause, the runtime provides what they need, they resume.

This isn't just a clever trick - it's a fundamental architectural pattern that scales from simple scripts to complex applications. The same principle that powers Redux-Saga, Effect-TS, and other production systems is now yours to use.

The key insight is the shift from PUSH to PULL:
- **PUSH**: Force dependencies through every function
- **PULL**: Let functions request what they need

This simple change transforms how you structure applications. No more dependency passing through layers of functions. No more tightly coupled code. Just clean, testable, composable workflows.

Start small. Copy the runtime. Convert one function. Experience the freedom.

<br />

*Found this useful? Share it with your team. The pattern is powerful, but it's even better when everyone understands it.*
