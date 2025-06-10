// Simple type test to verify our improvements work correctly
import { 
  createContext, 
  defineTask, 
  validateContext,
  mergeContexts,
  createInjectionToken,
  inject,
  createContextProvider,
  type BaseContext,
  type ContextSchema,
  type MergeContexts
} from './src/run';

// Test basic context structure
interface AppContext extends BaseContext {
  database: { query: (sql: string) => Promise<string[]> };
  logger: { info: (msg: string) => void };
}

// Test context schema validation
const schema: ContextSchema<AppContext> = {
  database: (value): value is AppContext['database'] => 
    typeof value === 'object' && value !== null && 'query' in value,
  logger: (value): value is AppContext['logger'] => 
    typeof value === 'object' && value !== null && 'info' in value
};

// Test context creation and validation
const defaultContext = {
  database: { query: async (sql: string) => [] },
  logger: { info: (msg: string) => console.log(msg) }
};

const { run, defineTask: createTask, getContext } = createContext<AppContext>(defaultContext);

// Test task definition with typed context
const fetchUser = createTask(async (userId: string) => {
  const { database, logger } = getContext();
  logger.info(`Fetching user ${userId}`);
  const result = await database.query(`SELECT * FROM users WHERE id = ${userId}`);
  return result[0];
});

// Test context merging
const baseCtx: AppContext = {
  scope: { signal: new AbortController().signal },
  database: { query: async () => [] },
  logger: { info: () => {} }
};

const enhancement = { cache: new Map() };
const merged: MergeContexts<AppContext, { cache: Map<string, unknown> }> = 
  mergeContexts(baseCtx, enhancement);

// Test dependency injection
const DatabaseToken = createInjectionToken<{ query: (sql: string) => Promise<string[]> }>('Database');
const { Provider: DatabaseProvider } = createContextProvider(DatabaseToken);

const serviceTask = createTask(async (data: string) => {
  const db = inject(DatabaseToken);
  return db.query(`SELECT * FROM data WHERE value = ${data}`);
});

// Test context validation
const validationResult = validateContext(schema, {
  scope: { signal: new AbortController().signal },
  database: { query: async () => [] },
  logger: { info: () => {} }
});

console.log('Type test completed successfully!');
