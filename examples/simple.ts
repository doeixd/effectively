import { createContext, createWorkflow, tap, type Scope } from '../src/index';

// === Simple Examples of the Effectively Library ===

// Define the shape of our application context
interface AppContext {
  scope: Scope;  // Required by the library
  apiKey: string;
  multiplier: number;
  logger: {
    log: (message: string) => void;
    error: (message: string) => void;
  };
}

// Create context and get the core tools
const { run, defineTask, getContext } = createContext<AppContext>({
  apiKey: 'demo-key-123',
  multiplier: 2,
  logger: {
    log: (message: string) => console.log(`[LOG] ${message}`),
    error: (message: string) => console.error(`[LOG] ${message}`),
  },
});

// === Example 1: Basic Task Definition ===

// Simple task that uses context to greet someone
const greet = defineTask(async (name: string) => {
  const { logger } = getContext();
  logger.log(`Greeting ${name}`);
  return `Hello, ${name}!`;
});

// Task that multiplies a number using context
const multiply = defineTask(async (value: number) => {
  const { multiplier } = getContext();
  return value * multiplier;
});

// Task that makes a "fake API call"
const fetchData = defineTask(async (id: string) => {
  const { apiKey, logger } = getContext();
  logger.log(`Fetching data for ID: ${id} with key: ${apiKey}`);
  
  // Simulate API delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return { id, data: `Some data for ${id}`, timestamp: Date.now() };
});

// === Example 2: Simple Processing Task ===

const processData = defineTask(async (data: { id: string; data: string; timestamp: number }) => {
  const { logger } = getContext();
  logger.log(`Processing data for ID: ${data.id}`);
  
  return {
    ...data,
    processed: true,
    processedAt: Date.now()
  };
});

// === Example 3: Error Handling ===

// Task that might fail
const unreliableTask = defineTask(async (input: string) => {
  const { logger } = getContext();
  
  if (Math.random() < 0.3) {
    logger.log(`Task failed for input: ${input}`);
    throw new Error(`Failed to process: ${input}`);
  }
  
  logger.log(`Task succeeded for input: ${input}`);
  return `Processed: ${input}`;
});

// === Example 4: Running the Examples ===

async function runExamples() {
  console.log('=== Effectively Library Examples ===\n');

  try {
    // Example 1: Basic task execution
    console.log('1. Basic task execution:');
    const greeting = await run(greet, 'World');
    console.log(`   Greeting result: ${greeting}`);
    
    const doubled = await run(multiply, 10);
    console.log(`   Multiplication result: ${doubled}\n`);

    // Example 2: API-like task
    console.log('2. Data fetching:');
    const apiResult = await run(fetchData, 'user-123');
    console.log(`   API result:`, apiResult, '\n');

    // Example 3: Data processing
    console.log('3. Data processing:');
    const processedResult = await run(processData, apiResult);
    console.log(`   Processed result:`, processedResult, '\n');

    // Example 4: Error handling with Result type
    console.log('4. Error handling with Result type:');
    
    // Try a few times to demonstrate random failure
    for (let i = 0; i < 5; i++) {
      const result = await run(unreliableTask, `attempt-${i + 1}`, { throw: false });
      
      if (result.isOk()) {
        console.log(`   ✓ Success: ${result.value}`);
      } else {
        console.log(`   ✗ Error: ${result.error.message}`);
      }
    }

  } catch (error) {
    console.error('Example failed:', error);
  }
}

// === Example 5: Context Overrides for Testing ===

async function testingExample() {
  console.log('\n=== Testing with Context Overrides ===');
  
  // Override the logger and multiplier for testing
  const testResult = await run(greet, 'Test User', {
    overrides: {
      logger: {
        log: (msg) => console.log(`[TEST] ${msg}`),
        error: (msg) => console.error(`[TEST] ${msg}`)
      }
    }
  });
  
  console.log(`Test greeting result: ${testResult}`);
  
  // Test with different multiplier
  const testMultiply = await run(multiply, 5, {
    overrides: {
      multiplier: 10
    }
  });
  
  console.log(`Test multiplication (5 * 10): ${testMultiply}`);
}

// === Example 6: Create Workflow Composition ===

async function workflowExample() {
  console.log('\n=== Workflow Composition ===');
  // Chain tasks together by createWorkflow
  const userId = 'workflow-user-456';

  // Step 1: Build workflow
  const exampleWorkflow = createWorkflow(
    fetchData,
    tap((fetchedData) => { console.log('Fetched data', fetchedData) }),
    processData,
  )

  // Step 2: Run workflow
  const result = await run(exampleWorkflow, userId);
  console.log('Workflow finished:', result)
}

// === Example 7: Manual Workflow Composition ===

async function manualWorkflowExample() {
  console.log('\n=== Manual Workflow Composition ===');
  
  try {
    // Manually chain tasks together
    const userId = 'workflow-user-456';
    
    // Step 1: Fetch data
    const fetchedData = await run(fetchData, userId);
    console.log('Step 1 - Fetched:', fetchedData);
    
    // Step 2: Process the fetched data
    const processedData = await run(processData, fetchedData);
    console.log('Step 2 - Processed:', processedData);
    
    // Step 3: Create a summary
    const summary = `User ${fetchedData.id} processed at ${processedData.processedAt}`;
    console.log('Step 3 - Summary:', summary);
    
  } catch (error) {
    console.error('Manual workflow failed:', error);
  }
}

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Starting Effectively library examples...\n');

  Promise.resolve()
    .then(() => runExamples())
    .then(() => testingExample())
    .then(() => workflowExample())
    .then(() => manualWorkflowExample())
    .then(() => console.log('\nAll examples completed!'))
    .catch(console.error);
}

// Export for use in other files
export {
  greet,
  multiply,
  fetchData,
  processData,
  unreliableTask,
  runExamples
};
