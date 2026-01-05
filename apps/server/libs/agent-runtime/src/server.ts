import 'dotenv/config';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { agentsRouter } from './routes/agents.js';
import { blueprintsRouter } from './routes/blueprints.js';
import { batchTestRouter } from './routes/batch-test.js';
import { toolsRouter } from './routes/tools.js';
import { setContext } from './context.js';
import { AgentService } from './services/agent.service.js';
import { BlueprintService } from './services/blueprint.service.js';
import { createLLMAdapter } from './llm/index.js';
import {
  getDatabaseUrl,
  initDatabaseFromUrl,
  type PostgresJsDatabase,
} from './db/index.js';
import type { LLMConfig, StorageProvider } from '@team9/agent-framework';
import {
  MemoryManager,
  createDefaultReducerRegistry,
  DefaultDebugController,
  InMemoryStorageProvider,
  PostgresStorageProvider,
} from '@team9/agent-framework';

// Get OpenRouter API key from environment
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (OPENROUTER_API_KEY) {
  console.log('OpenRouter API key loaded');
} else {
  console.warn('OPENROUTER_API_KEY not set, using mock LLM adapter');
}

// Storage mode: 'memory' or 'postgres'
const STORAGE_MODE = process.env.STORAGE_MODE || 'memory';

// Shared database instance for postgres mode
let dbInstance: PostgresJsDatabase<Record<string, never>> | null = null;

// Shared storage provider instance (singleton)
let sharedStorageProvider: StorageProvider | null = null;

/**
 * Initialize and get the shared storage provider
 */
function getStorageProvider(): StorageProvider {
  if (sharedStorageProvider) {
    return sharedStorageProvider;
  }

  if (STORAGE_MODE === 'postgres' && dbInstance) {
    console.log('Creating PostgreSQL storage provider');
    sharedStorageProvider = new PostgresStorageProvider(dbInstance);
  } else {
    console.log('Creating in-memory storage provider');
    sharedStorageProvider = new InMemoryStorageProvider();
  }

  return sharedStorageProvider;
}

// Factory functions for creating framework instances
const createMemoryManager = (config: LLMConfig) => {
  // Use shared storage provider
  const storage = getStorageProvider();
  const reducerRegistry = createDefaultReducerRegistry();

  // Create LLM adapter - uses OpenRouter if API key is available, otherwise mock
  const llmAdapter = createLLMAdapter(
    config.model || 'anthropic/claude-sonnet-4',
    OPENROUTER_API_KEY,
  );

  return new MemoryManager(storage, reducerRegistry, llmAdapter, {
    llm: config,
    autoCompactEnabled: true,
  });
};

const createDebugController = (memoryManager: unknown) => {
  // Use the same shared storage provider
  const storage = getStorageProvider();
  return new DefaultDebugController(memoryManager as any, storage);
};

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health check
app.get('/health', (c) =>
  c.json({
    status: 'ok',
    timestamp: Date.now(),
    storage: STORAGE_MODE,
    database: dbInstance ? 'connected' : 'not connected',
  }),
);

// API routes
app.route('/api/agents', agentsRouter);
app.route('/api/blueprints', blueprintsRouter);
app.route('/api/batch-test', batchTestRouter);
app.route('/api/tools', toolsRouter);

// Start server
async function start() {
  const port = Number(process.env.PORT) || 3001;

  // Initialize database if configured
  if (STORAGE_MODE === 'postgres') {
    const dbUrl = getDatabaseUrl();
    if (dbUrl) {
      try {
        dbInstance = await initDatabaseFromUrl(dbUrl);
        console.log('Database initialized successfully');
      } catch (error) {
        console.error('Failed to initialize database:', error);
        console.warn('Falling back to in-memory storage');
      }
    } else {
      console.warn('Database configuration not found, using in-memory storage');
      console.warn(
        'Set DEBUGGER_DB_URL or DB_HOST/DB_USER/DB_PASSWORD/DB_NAME',
      );
    }
  }

  // Create a shared LLM adapter factory for executor
  const getLLMAdapter = () => {
    // Default model for agent executor
    return createLLMAdapter(
      process.env.DEFAULT_MODEL || 'anthropic/claude-sonnet-4.5',
      OPENROUTER_API_KEY,
    );
  };

  // Initialize services after database is ready
  const agentService = new AgentService(
    createMemoryManager,
    createDebugController,
    getLLMAdapter,
    dbInstance,
  );
  const blueprintService = new BlueprintService(dbInstance);
  setContext({ agentService, blueprintService });

  // Restore agents from database
  await agentService.restoreAgents();

  console.log(`Agent Runtime server starting on port ${port}...`);
  console.log(`Storage mode: ${STORAGE_MODE}`);

  serve({
    fetch: app.fetch,
    port,
  });

  console.log(`Agent Runtime server running at http://localhost:${port}`);
}

start().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
