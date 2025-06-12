const { createContext, defineTask, createBracketTools, bracket: mainBracket } = require('../dist/index.cjs');

const testContextDefaults = {
  logs: [],
  connections: []
};

const { run, defineTask: dt, getContext, provide } = createContext(testContextDefaults);
const { bracket, bracketMany } = createBracketTools({ run, defineTask: dt, getContext }); // Remove provide

class MockConnection {
  constructor(id) {
    this.id = id;
    this.closed = false;
  }
  
  async close() {
    if (!this.closed) {
      this.closed = true;
    }
  }
}

async function testBracketMany() {
  const resource1 = new MockConnection('resource-1');
  const resource2 = new MockConnection('resource-2');
  
  const acquireTask1 = dt(async () => resource1);
  const acquireTask2 = dt(async () => resource2);

  const releaseTask1 = dt(async (resource) => {
    console.log('Releasing resource:', resource.id);
    await resource.close();
    if (resource.id === 'resource-1') {
      throw new Error('Release 1 failed');
    }
  });

  const releaseTask2 = dt(async (resource) => {
    await resource.close();
  });

  const useTask = dt(async () => 'success');

  // Test main bracket first  
  const workflow0 = mainBracket({
    acquire: acquireTask1,
    use: useTask,
    release: releaseTask1,
    merge: (ctx, res) => ({ ...ctx, resource1: res })
  });

  console.log('Testing main bracket with non-throwing release...');
  try {
    const result0 = await run(workflow0, 'test-input');
    console.log('Main bracket result:', result0);
  } catch (error) {
    console.log('Main bracket error:', error.message);
  }

  // Test single bracket first
  const workflow1 = bracket({
    acquire: acquireTask1,
    use: useTask,
    release: releaseTask1,
    merge: (ctx, res) => ({ ...ctx, resource1: res })
  });

  console.log('Testing context bracket with non-throwing release...');
  try {
    const result1 = await run(workflow1, 'test-input');
    console.log('Context bracket result:', result1);
  } catch (error) {
    console.log('Context bracket error:', error.message);
  }

  // Reset resources
  resource1.closed = false;

  const workflow = bracketMany([
    {
      acquire: acquireTask1,
      release: releaseTask1,
      merge: (ctx, res) => ({ ...ctx, resource1: res })
    },
    {
      acquire: acquireTask2,
      release: releaseTask2,
      merge: (ctx, res) => ({ ...ctx, resource2: res })
    }
  ], useTask);

  try {
    const result = await run(workflow, 'test-input');
    console.log('Result:', result);
    console.log('Resource1 closed:', resource1.closed);
    console.log('Resource2 closed:', resource2.closed);
  } catch (error) {
    console.error('Error:', error);
  }
}

testBracketMany();
