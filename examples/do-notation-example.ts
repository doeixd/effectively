/**
 * Example demonstrating the do notation feature with generator syntax
 */

import {
  createContext,
  defineTask,
  getContext,
  type BaseContext
} from '../src/run';

import {
  doTask,
  createDoNotation,
  call,
  pure,
  doWhen,
  doUnless,
  sequence
} from '../src/do-notation';

interface UserProfile {
  id: string; name: string; email: string; isActive: boolean;
}
interface AuthorPost {
  id: string; title: string; content: string; authorId: string
}

// Define application context
interface AppContext extends BaseContext {
  database: {
    users: Map<string, UserProfile>;
    posts: Map<string, AuthorPost>;
  };
  logger: {
    info: (message: string) => void;
    error: (message: string) => void;
  };
}

// Create context and do notation helpers
const { run } = createContext<AppContext>({
  database: {
    users: new Map([
      ['1', { id: '1', name: 'Alice', email: 'alice@example.com', isActive: true } satisfies UserProfile],
      ['2', { id: '2', name: 'Bob', email: 'bob@example.com', isActive: false } satisfies UserProfile],
    ]),
    posts: new Map([
      ['1', { id: '1', title: 'Hello World', content: 'First post!', authorId: '1' } satisfies AuthorPost],
      ['2', { id: '2', title: 'TypeScript Tips', content: 'Some tips...', authorId: '1' } satisfies AuthorPost],
    ])
  },
  logger: {
    info: (msg) => console.log(`ℹ️ ${msg}`),
    error: (msg) => console.error(`❌ ${msg}`)
  }
});

const { doTask: appDoTask } = createDoNotation<AppContext>();

// Define tasks
const getUser = defineTask<AppContext, string, { id: string; name: string; email: string; isActive: boolean } | null>(
  async (userId: string) => {
    const { database } = getContext<AppContext>();
    return database.users.get(userId) || null;
  }
);

const getUserPosts = defineTask<AppContext, string, Array<{ id: string; title: string; content: string }>>(
  async (userId: string) => {
    const { database } = getContext<AppContext>();
    const posts = Array.from(database.posts.values())
      .filter(post => post.authorId === userId);
    return posts;
  }
);

const activateUser = defineTask<AppContext, string, void>(async (userId: string) => {
  const { database, logger } = getContext<AppContext>();
  const user = database.users.get(userId);
  if (user) {
    user.isActive = true;
    logger.info(`User ${userId} activated`);
  }
});

const logUserInfo = defineTask<AppContext, string, void>(async (message: string) => {
  const { logger } = getContext<AppContext>();
  logger.info(message);
});

// Example 1: Basic do notation workflow
const getUserProfile = appDoTask(function* (userId: string) {
  yield call(logUserInfo, `Fetching profile for user ${userId}`);
  
  const user = yield call(getUser, userId);
  
  if (!user) {
    throw new Error(`User ${userId} not found`);
  }
  
  // Activate user if they're inactive
  yield doUnless(user.isActive, () => call(activateUser, userId));
  
  // Get user's posts
  const posts = yield call(getUserPosts, userId);
  
  yield call(logUserInfo, `Found ${posts.length} posts for user ${user.name}`);
  
  return {
    user,
    posts,
    summary: `${user.name} has ${posts.length} posts`
  };
});

// Example 2: Processing multiple users
const getUserProfiles = appDoTask(function* (userIds: string[]) {
  yield call(logUserInfo, `Processing ${userIds.length} user profiles`);
  
  // Process users sequentially
  const profiles = yield call(sequence(
    userIds.map(id => call(getUserProfile, id))
  ), undefined);
  
  // Filter out any failed profiles (this is simplified)
  const validProfiles = profiles.filter((p: UserProfile) => p !== null);

  yield call(logUserInfo, `Successfully processed ${validProfiles.length} profiles`);
  
  return validProfiles;
});

// Example 3: Conditional processing with error handling
const processUserWithFallback = appDoTask(function* (userId: string) {
  try {
    // Try to get the full profile
    const profile = yield call(getUserProfile, userId);
    return { success: true, data: profile };
  } catch (error) {
    // Fallback: just get basic user info
    yield call(logUserInfo, `Profile fetch failed for ${userId}, trying basic info`);
    
    const user = yield call(getUser, userId);
    
    const result = yield doWhen(
      user !== null,
      () => pure({ id: user.id, name: user.name }),
      () => pure(null)
    );
    
    return { success: false, data: result };
  }
});

// Run examples
async function runExamples() {
  console.log('=== Do Notation Examples ===\n');
  
  try {
    // Example 1: Single user profile
    console.log('1. Getting user profile:');
    const profile1 = await run(getUserProfile, '1');
    console.log('Result:', JSON.stringify(profile1, null, 2));
    console.log();
    
    // Example 2: Multiple users
    console.log('2. Getting multiple user profiles:');
    const profiles = await run(getUserProfiles, ['1', '2']);
    console.log(`Processed ${profiles.length} profiles`);
    console.log();
    
    // Example 3: Error handling
    console.log('3. Processing with fallback:');
    const result1 = await run(processUserWithFallback, '1');
    console.log('User 1 result:', result1.success ? 'Success' : 'Fallback');
    
    const result2 = await run(processUserWithFallback, '999'); // Non-existent user
    console.log('User 999 result:', result2.success ? 'Success' : 'Fallback');
    
  } catch (error) {
    console.error('Example failed:', error);
  }
}

// Export for potential use in other examples
export {
  getUserProfile,
  getUserProfiles,
  processUserWithFallback,
  runExamples
};

// Run examples if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExamples();
}
