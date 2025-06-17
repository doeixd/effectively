# Context Design: Why Overrides Over Direct Parameters

When designing the execution model for Effectively, we faced a fundamental choice in how tasks receive their dependencies. Should tasks receive context as a direct parameter, or through an inherited context system with selective overrides? This document explores why we chose the latter approach and how it enables more powerful patterns.

## The Two Approaches

### Direct Context Passing
```typescript
// Hypothetical alternative design
const result = await run(task, inputValue, contextObject);

// Every execution requires the full context
await run(fetchUser, userId, { 
  api: myApi, 
  db: myDb, 
  logger: myLogger,
  cache: myCache 
});
```

### Context Inheritance with Overrides (Current Design)
```typescript
// Current design
const { run } = createContext({ 
  api: myApi, 
  db: myDb, 
  logger: myLogger,
  cache: myCache 
});

// Execution inherits base context, selectively overrides
await run(fetchUser, userId, {
  overrides: { logger: testLogger } // Only specify what's different
});
```

## Why Context Inheritance is Superior

### 1. Compositional Dependency Injection

Context inheritance treats dependencies as a **layered system** rather than flat parameters. This mirrors how real applications work - you have:

- **Application-level dependencies** (databases, APIs, configuration)
- **Request-level dependencies** (user session, request ID, tracing context)  
- **Test-level dependencies** (mocks, test databases, silent loggers)

```typescript
// Base application context
const { run } = createContext({
  api: productionApi,
  db: productionDb,
  logger: productionLogger,
  metrics: productionMetrics
});

// Request-scoped execution
app.post('/users', async (req) => {
  const result = await run(createUser, req.body, {
    overrides: {
      requestId: req.id,
      userId: req.user.id,
      // Inherits all production dependencies
    }
  });
});

// Test execution
test('should create user', async () => {
  const result = await run(createUser, userData, {
    overrides: {
      api: mockApi,
      db: testDb,
      logger: silentLogger,
      // Still inherits metrics and other services
    }
  });
});
```

With direct context passing, you'd need to reconstruct the entire dependency graph for every scenario.

### 2. Natural Context Nesting

Tasks often call other tasks. Context inheritance allows nested executions to automatically receive the appropriate context without explicit threading.

```typescript
const processOrder = defineTask(async (order: Order) => {
  // This task calls other tasks internally
  const user = await run(fetchUser, order.userId);
  const payment = await run(processPayment, order.payment);
  const shipping = await run(scheduleShipping, order.items);
  
  return { user, payment, shipping };
});

// When you run processOrder with overrides, ALL nested tasks inherit them
await run(processOrder, orderData, {
  overrides: { 
    environment: 'test',
    logger: testLogger 
  }
});
// fetchUser, processPayment, and scheduleShipping all get test context
```

With direct context passing, every internal `run()` call would need explicit context management:

```typescript
// Hypothetical with direct context - verbose and error-prone
const processOrder = defineTask(async (order: Order, context: Context) => {
  const user = await run(fetchUser, order.userId, context);
  const payment = await run(processPayment, order.payment, context);
  const shipping = await run(scheduleShipping, order.items, context);
  
  return { user, payment, shipping };
});
```

### 3. Clean Testing and Mocking

The override pattern makes testing ergonomic by letting you replace only what's different:

```typescript
// Production context
const { run } = createContext({
  stripe: realStripeApi,
  db: postgresDb,
  email: sendgridService,
  logger: structuredLogger,
  metrics: datadogMetrics,
  cache: redisCache
});

// Test overrides - only mock what you need to control
describe('payment processing', () => {
  it('handles successful payments', async () => {
    const mockStripe = { charge: jest.fn().mockResolvedValue({ id: 'ch_123' }) };
    
    const result = await run(processPayment, paymentData, {
      overrides: { 
        stripe: mockStripe,
        logger: silentLogger 
      }
      // Inherits real db, email, metrics, cache
    });
    
    expect(mockStripe.charge).toHaveBeenCalled();
  });
  
  it('handles network failures', async () => {
    const failingStripe = { charge: jest.fn().mockRejectedValue(new Error('Network')) };
    
    const result = await run(processPayment, paymentData, {
      throw: false,  // Get Result instead of throwing
      overrides: { stripe: failingStripe }
    });
    
    expect(result.isErr()).toBe(true);
  });
});
```

### 4. Environment-Specific Execution

Different environments often need different implementations of the same interface:

```typescript
// Same task, different environments
const deploymentTask = defineTask(async (config: DeployConfig) => {
  const { kubectl, docker, secrets } = getContext();
  
  await kubectl.apply(config.manifest);
  await docker.push(config.image);
  await secrets.update(config.secrets);
});

// Development environment
await run(deploymentTask, devConfig, {
  overrides: {
    kubectl: localKubectl,
    docker: localDocker,
    secrets: localSecrets
  }
});

// Production environment
await run(deploymentTask, prodConfig, {
  overrides: {
    kubectl: prodKubectl,
    docker: prodRegistry,
    secrets: vaultSecrets
  }
});

// CI/Test environment
await run(deploymentTask, testConfig, {
  overrides: {
    kubectl: mockKubectl,
    docker: mockDocker,
    secrets: mockSecrets
  }
});
```

### 5. Request Tracing and Observability

Context inheritance naturally supports cross-cutting concerns like tracing:

```typescript
// Request handler automatically adds tracing context
app.use(async (req, res, next) => {
  const traceId = generateTraceId();
  
  // All tasks in this request inherit tracing context
  req.runWithTracing = (task, input, options = {}) => 
    run(task, input, {
      ...options,
      overrides: {
        ...options.overrides,
        traceId,
        spanContext: createSpanContext(traceId)
      }
    });
  
  next();
});

// Business logic doesn't need to know about tracing
app.post('/orders', async (req) => {
  const order = await req.runWithTracing(createOrder, req.body);
  // createOrder and all its subtasks automatically get tracing
});
```

## Context as Scoped Dependency Injection

The override pattern implements **scoped dependency injection** at the execution level. This is a powerful pattern from enterprise frameworks, adapted for async workflows:

```typescript
// Think of it like dependency injection scopes:
// Application Scope -> Request Scope -> Operation Scope

const applicationContext = createContext({
  // Application-scoped (singleton-like) dependencies
  database: postgresPool,
  messageQueue: rabbitmq,
  logger: structuredLogger
});

// Request scope adds request-specific context
const requestContext = {
  overrides: {
    requestId: uuid(),
    userId: req.user.id,
    permissions: req.user.permissions
  }
};

// Operation scope might add operation-specific overrides
const operationContext = {
  overrides: {
    ...requestContext.overrides,
    retryCount: 0,
    timeout: 30000
  }
};
```

## Alternative Designs Considered

### Builder Pattern
```typescript
// Could work but more verbose
const execution = contextBuilder()
  .withApi(myApi)
  .withDb(testDb)
  .withLogger(silentLogger)
  .build();

await execution.run(task, input);
```

### Immutable Context Merging
```typescript
// Could work but requires more complex context API
const baseContext = createContext({ api, db, logger });
const testContext = baseContext.with({ logger: silentLogger });

await run(task, input, testContext);
```

### Direct Parameter with Merging
```typescript
// Verbose and loses inheritance benefits
await run(task, input, { ...baseContext, logger: silentLogger });
```

## The Mental Model

The key insight is that **context represents your application's capability graph**, not just parameters. When you override parts of the context, you're saying:

> "Execute this task with the same capabilities as usual, except use this different implementation for logging/database/etc."

This is fundamentally different from parameter passing, which treats each execution as isolated. Context inheritance recognizes that:

1. **Most dependencies stay the same** across executions
2. **Changes are typically scoped** (per-request, per-test, per-environment)
3. **Nested operations should inherit context** automatically
4. **Testing requires surgical precision** in what you mock

## Conclusion

The override pattern in Effectively's `run()` function enables:

- **Compositional dependency injection** with natural layering
- **Automatic context inheritance** in nested task execution
- **Clean testing patterns** with minimal mocking surface area
- **Environment-specific execution** without code changes
- **Cross-cutting concerns** like tracing and metrics

While direct context passing might seem simpler at first glance, it fails to capture the hierarchical and compositional nature of real application dependencies. The override pattern provides a more powerful and ergonomic foundation for building resilient, testable applications.

The design recognizes that in real applications, **context is not just data - it's your application's execution environment**. And environments are inherited, composed, and selectively modified, not built from scratch for every operation.