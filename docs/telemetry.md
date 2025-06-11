# OpenTelemetry Integration

Effectively provides comprehensive OpenTelemetry integration for observability, tracing, and metrics in your asynchronous workflows. The integration works seamlessly with existing OpenTelemetry setups while providing graceful fallbacks when OpenTelemetry is not configured.

## Quick Start

```typescript
import { 
  withSpan, 
  withObservability, 
  createTelemetryContext,
  recordMetric 
} from 'effectively';

// Create context with OpenTelemetry providers
const context = createTelemetryContext({
  tracer: trace.getTracer('my-app'),
  meter: metrics.getMeter('my-app'),
  logger: console
});

// Simple span tracing
const tracedTask = withSpan(fetchUserData, {
  name: 'fetch_user_data',
  attributes: { userId: '123' }
});

// Full observability (spans + metrics)
const observedTask = withObservability(processOrder, {
  spanName: 'process_order',
  enableTiming: true,
  enableCounting: true
});

await run(observedTask, context, orderId);
```

## Core Concepts

### Telemetry Context

The telemetry system extends your context with optional OpenTelemetry providers:

```typescript
interface TelemetryContext {
  telemetry?: {
    tracer?: any;    // OpenTelemetry Tracer
    meter?: any;     // OpenTelemetry Meter  
    logger?: any;    // Logger interface
  };
}
```

### Graceful Degradation

All telemetry functions provide fallbacks when OpenTelemetry is not available:
- Spans fall back to structured logging
- Metrics fall back to debug logging
- No runtime errors when providers are missing

## Primitives

### Distributed Tracing

#### `withSpan(task, options)`

Wraps a task with distributed tracing support:

```typescript
import { withSpan, defineTask } from 'effectively';

const fetchUser = defineTask(async (userId: string) => {
  // Business logic here
  return await userService.fetch(userId);
});

const tracedFetch = withSpan(fetchUser, {
  name: 'user_service_fetch',
  kind: 'client',
  attributes: {
    'service.name': 'user-service',
    'operation.type': 'fetch'
  }
});

// Creates span hierarchy automatically
await run(tracedFetch, context, 'user-123');
```

**Options:**
- `name?: string` - Span name (defaults to task name)
- `kind?: 'internal' | 'server' | 'client' | 'producer' | 'consumer'`
- `attributes?: Record<string, string | number | boolean>` - Span attributes

#### Manual Span Management

```typescript
import { addSpanAttributes, recordSpanException, getCurrentSpan } from 'effectively';

const processData = defineTask(async (context, data) => {
  // Add runtime attributes
  addSpanAttributes(context, {
    'data.size': data.length,
    'processing.batch_id': generateBatchId()
  });
  
  try {
    return await heavyProcessing(data);
  } catch (error) {
    // Record exception in span
    recordSpanException(context, error);
    throw error;
  }
});
```

### Metrics Collection

#### `recordMetric(context, type, options, value)`

Records metrics with automatic fallback to logging:

```typescript
import { recordMetric, defineTask } from 'effectively';

const processPayment = defineTask(async (context, payment) => {
  const startTime = performance.now();
  
  try {
    const result = await paymentGateway.process(payment);
    
    // Success metrics
    recordMetric(context, 'counter', {
      name: 'payments_processed',
      attributes: { 
        status: 'success',
        gateway: payment.gateway,
        amount_range: categorizeAmount(payment.amount)
      }
    });
    
    // Duration metric
    recordMetric(context, 'histogram', {
      name: 'payment_processing_duration',
      unit: 'ms',
      attributes: { gateway: payment.gateway }
    }, performance.now() - startTime);
    
    return result;
  } catch (error) {
    recordMetric(context, 'counter', {
      name: 'payments_processed',
      attributes: { status: 'error', gateway: payment.gateway }
    });
    throw error;
  }
});
```

**Metric Types:**
- `counter` - Monotonically increasing values
- `histogram` - Distribution of values over time
- `gauge` - Current value that can go up or down

## Higher-Level Tools

### Complete Observability

#### `withObservability(task, options)`

Combines tracing, timing, and counting in one wrapper:

```typescript
import { withObservability } from 'effectively';

const completelyObservedTask = withObservability(complexBusinessLogic, {
  spanName: 'complex_business_logic',
  spanAttributes: { 
    'business.domain': 'order-processing',
    'complexity.level': 'high' 
  },
  enableTiming: true,     // Records duration histogram
  enableCounting: true,   // Records success/error counters
  metricPrefix: 'business_logic'  // Prefix for generated metrics
});

// Automatically creates:
// - Span: "complex_business_logic"
// - Histogram: "business_logic_duration" 
// - Counter: "business_logic_executions"
```

### Specialized Wrappers

#### `withTiming(task, metricName)`

Focused on execution time measurement:

```typescript
import { withTiming } from 'effectively';

const timedDatabaseQuery = withTiming(
  executeQuery, 
  'database_query_duration'
);

// Records histogram with success/error status
await run(timedDatabaseQuery, context, query);
```

#### `withCounter(task, counterName)`

Focused on execution counting:

```typescript
import { withCounter } from 'effectively';

const countedApiCall = withCounter(
  callExternalApi,
  'external_api_calls'
);

// Records counter with success/error status
await run(countedApiCall, context, request);
```

### Method Decorators

#### `@traced(spanName?)`

Automatic tracing for class methods:

```typescript
import { traced } from 'effectively';

class OrderService {
  context: TelemetryContext;
  
  @traced('order_service_create')
  async createOrder(orderData: OrderData) {
    // Automatically wrapped with span
    return await this.database.insert(orderData);
  }
  
  @traced() // Uses "OrderService.updateOrder" as span name
  async updateOrder(id: string, updates: Partial<OrderData>) {
    return await this.database.update(id, updates);
  }
}
```

## Advanced Patterns

### Nested Spans

```typescript
import { withSpan, startChildSpan } from 'effectively';

const processOrderWorkflow = withSpan(
  defineTask(async (context, order) => {
    // Parent span: "process_order"
    
    // Manual child spans for sub-operations
    const validationSpan = startChildSpan(context, 'validate_order', {
      attributes: { orderId: order.id }
    });
    
    try {
      await validateOrder(order);
      validationSpan?.setStatus({ code: 1 });
    } catch (error) {
      validationSpan?.recordException(error);
      validationSpan?.setStatus({ code: 2, message: error.message });
      throw error;
    } finally {
      validationSpan?.end();
    }
    
    // Nested traced tasks create child spans automatically
    await run(withSpan(chargePayment, { name: 'charge_payment' }), context, order.payment);
    await run(withSpan(fulfillOrder, { name: 'fulfill_order' }), context, order);
    
    return { orderId: order.id, status: 'completed' };
  }),
  { name: 'process_order' }
);
```

### Custom Metrics Dashboards

```typescript
import { recordMetric } from 'effectively';

const businessMetricsTask = defineTask(async (context, businessData) => {
  // Custom business metrics
  recordMetric(context, 'gauge', {
    name: 'active_users_count',
    description: 'Number of currently active users',
    attributes: { region: businessData.region }
  }, businessData.activeUsers);
  
  recordMetric(context, 'histogram', {
    name: 'revenue_per_transaction',
    unit: 'USD',
    description: 'Revenue distribution per transaction',
    attributes: { 
      product_category: businessData.category,
      customer_tier: businessData.customerTier
    }
  }, businessData.revenue);
  
  // Process business logic...
});
```

### Integration with Existing Systems

#### Jaeger Integration

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { createTelemetryContext } from 'effectively';

// Setup OpenTelemetry SDK
const sdk = new NodeSDK({
  traceExporter: new JaegerExporter({
    endpoint: 'http://localhost:14268/api/traces',
  }),
});

sdk.start();

// Create telemetry context
const context = createTelemetryContext({
  tracer: trace.getTracer('my-application', '1.0.0'),
  meter: metrics.getMeter('my-application', '1.0.0'),
  logger: winston.createLogger(/* config */)
});
```

#### Prometheus Integration

```typescript
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';

const meterProvider = new MeterProvider({
  readers: [new PrometheusExporter({
    port: 9090,
    endpoint: '/metrics',
  }, () => {
    console.log('Prometheus metrics server started on port 9090');
  })],
});

const context = createTelemetryContext({
  meter: meterProvider.getMeter('my-app')
});
```

## Production Considerations

### Performance Impact

- Spans have minimal overhead (~1-2μs per span)
- Metrics recording is async and non-blocking
- Fallback logging has negligible performance impact
- Consider sampling for high-throughput applications

### Memory Management

```typescript
// Use bounded attributes to prevent memory leaks
const boundedSpan = withOtelSpan(task, {
  attributes: {
    // Prefer low-cardinality attributes
    'service.name': 'user-service',
    'operation.type': 'query',
    // Avoid high-cardinality data like user IDs in attributes
    // 'user.id': userId  // ❌ Avoid this
  }
});
```

### Error Handling

```typescript
// Telemetry should never break your application
const resilientTask = defineTask(async (context, data) => {
  try {
    addSpanAttributes(context, { dataSize: data.length });
  } catch (telemetryError) {
    // Log but don't fail the task
    console.warn('Telemetry error:', telemetryError);
  }
  
  // Your business logic continues regardless
  return await processData(data);
});
```

## Migration from Basic Spans

If you're currently using the basic `withSpan` utility, migration is straightforward:

```typescript
// Before: Basic span logging
const oldTask = withSpan(myTask, 'my_operation');

// After: OpenTelemetry integration with fallback
const newTask = withSpan(myTask, { 
  name: 'my_operation' 
});

// Behavior is identical when no OpenTelemetry providers are configured
// But enables full observability when providers are available
```

## Best Practices

1. **Use semantic span names**: Prefer `user_service_fetch` over generic names
2. **Add meaningful attributes**: Include context that helps with debugging
3. **Avoid high-cardinality attributes**: Don't include user IDs or request IDs in span attributes
4. **Use structured naming**: Follow consistent patterns like `service_operation` 
5. **Enable sampling**: For high-throughput systems, configure appropriate sampling rates
6. **Monitor your monitoring**: Track telemetry overhead and adjust as needed

## Troubleshooting

### No spans appearing in trace backend

1. Verify OpenTelemetry SDK initialization
2. Check exporter configuration
3. Ensure context has valid tracer
4. Verify sampling configuration

### High memory usage

1. Review span attribute cardinality
2. Check for span leaks (unended spans)
3. Configure appropriate sampling rates
4. Monitor metrics cardinality

### Performance degradation

1. Enable async metric collection
2. Reduce span attribute size
3. Use sampling for high-frequency operations
4. Profile telemetry overhead

The OpenTelemetry integration in Effectively provides enterprise-grade observability while maintaining the library's core principles of simplicity and reliability.
