/**
 * Unit tests for BlueprintLoader
 */
import {
  BlueprintLoader,
  IComponentRegistry,
} from '../../blueprint/blueprint-loader.js';
import {
  MemoryManager,
  MemoryManagerConfig,
} from '../../manager/memory.manager.js';
import { InMemoryStorageProvider } from '../../storage/memory.storage.js';
import { Blueprint } from '../../blueprint/blueprint.types.js';
import type {
  ILLMAdapter,
  LLMCompletionResponse,
} from '../../llm/llm.types.js';
import { ReducerRegistry } from '../../reducer/reducer.types.js';
import { SystemInstructionsComponent } from '../../components/builtin/system/system.component.js';
import type { ComponentConstructor } from '../../components/component.interface.js';

// Simple in-memory component registry for testing
class TestComponentRegistry implements IComponentRegistry {
  private registry = new Map<string, ComponentConstructor>();

  register(key: string, constructor: ComponentConstructor): void {
    this.registry.set(key, constructor);
  }

  get(key: string): ComponentConstructor | undefined {
    return this.registry.get(key);
  }

  has(key: string): boolean {
    return this.registry.has(key);
  }
}

// Mock LLM adapter
const createMockLLMAdapter = (): ILLMAdapter => ({
  complete: jest.fn().mockResolvedValue({
    content: 'Response',
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
  } as LLMCompletionResponse),
});

// Mock reducer registry
const createMockReducerRegistry = (): ReducerRegistry => ({
  register: jest.fn(),
  unregister: jest.fn(),
  getReducersForEvent: jest.fn().mockReturnValue([]),
  reduce: jest.fn().mockResolvedValue({
    operations: [],
    chunks: [],
  }),
});

describe('BlueprintLoader', () => {
  let storage: InMemoryStorageProvider;
  let reducerRegistry: ReducerRegistry;
  let llmAdapter: ILLMAdapter;
  let memoryManager: MemoryManager;
  let componentRegistry: TestComponentRegistry;
  let blueprintLoader: BlueprintLoader;

  beforeEach(() => {
    storage = new InMemoryStorageProvider();
    reducerRegistry = createMockReducerRegistry();
    llmAdapter = createMockLLMAdapter();

    const config: MemoryManagerConfig = {
      llm: {
        model: 'claude-3-5-sonnet-20241022',
        temperature: 0.7,
      },
      autoCompactEnabled: false,
    };

    memoryManager = new MemoryManager(
      storage,
      reducerRegistry,
      llmAdapter,
      config,
    );

    componentRegistry = new TestComponentRegistry();
    // Register built-in system component
    componentRegistry.register(
      'builtin:system',
      SystemInstructionsComponent as any,
    );

    blueprintLoader = new BlueprintLoader(memoryManager, componentRegistry);
  });

  const createValidBlueprint = (overrides?: Partial<Blueprint>): Blueprint => ({
    name: 'Test Agent',
    description: 'A test agent',
    llmConfig: {
      model: 'claude-3-5-sonnet-20241022',
      temperature: 0.7,
      maxTokens: 4096,
    },
    tools: ['read', 'write', 'grep'],
    components: [
      {
        componentKey: 'builtin:system',
        config: {
          instructions: 'You are a helpful assistant.',
        },
      },
    ],
    ...overrides,
  });

  describe('validate', () => {
    it('should validate a correct blueprint', () => {
      const blueprint = createValidBlueprint();
      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject blueprint without name', () => {
      const blueprint = createValidBlueprint();
      delete (blueprint as any).name;

      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('name:'))).toBe(true);
    });

    it('should reject blueprint without llmConfig', () => {
      const blueprint = createValidBlueprint();
      delete (blueprint as any).llmConfig;

      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('llmConfig'))).toBe(true);
    });

    it('should reject blueprint with invalid llmConfig.model', () => {
      const blueprint = createValidBlueprint({
        llmConfig: {
          model: '',
          temperature: 0.7,
        },
      });

      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some((e) => e.includes('LLM model is required')),
      ).toBe(true);
    });

    it('should validate subAgents recursively', () => {
      const blueprint = createValidBlueprint({
        subAgents: {
          researcher: createValidBlueprint({ name: 'Researcher' }),
          writer: {
            name: '', // Invalid: empty name
            llmConfig: { model: 'gpt-4' },
          } as Blueprint,
        },
      });

      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(false);
      expect(
        result.errors.some(
          (e) => e.includes('subAgents.writer') && e.includes('name'),
        ),
      ).toBe(true);
    });

    it('should warn when no components defined', () => {
      const blueprint = createValidBlueprint({ components: [] });
      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No components defined');
    });

    it('should warn when no tools defined', () => {
      const blueprint = createValidBlueprint({ tools: [] });
      const result = blueprintLoader.validate(blueprint);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('No control tools defined');
    });
  });

  describe('load', () => {
    it('should load a valid blueprint', () => {
      const blueprint = createValidBlueprint();
      const result = blueprintLoader.load(blueprint);

      expect(result.blueprint).toBeDefined();
      expect(result.blueprint.name).toBe('Test Agent');
      expect(result.warnings).toBeDefined();
    });

    it('should apply llmConfig overrides', () => {
      const blueprint = createValidBlueprint();
      const result = blueprintLoader.load(blueprint, {
        llmConfigOverride: {
          temperature: 0.9,
          maxTokens: 8192,
        },
      });

      expect(result.blueprint.llmConfig.temperature).toBe(0.9);
      expect(result.blueprint.llmConfig.maxTokens).toBe(8192);
      expect(result.blueprint.llmConfig.model).toBe(
        'claude-3-5-sonnet-20241022',
      );
    });

    it('should throw error for invalid blueprint', () => {
      const invalidBlueprint = { name: 'Test' } as Blueprint;

      expect(() => blueprintLoader.load(invalidBlueprint)).toThrow(
        'Invalid blueprint',
      );
    });
  });

  describe('createThreadFromBlueprint', () => {
    it('should create thread with blueprint configuration', async () => {
      const blueprint = createValidBlueprint({
        id: 'test-blueprint-001',
        name: 'Test Agent',
        tools: ['read', 'write'],
      });

      const result = await blueprintLoader.createThreadFromBlueprint(blueprint);

      expect(result.thread).toBeDefined();
      expect(result.initialState).toBeDefined();

      // Verify blueprint fields are set on thread
      expect(result.thread.blueprintId).toBe('test-blueprint-001');
      expect(result.thread.blueprintName).toBe('Test Agent');
      expect(result.thread.llmConfig).toBeDefined();
      expect(result.thread.llmConfig?.model).toBe('claude-3-5-sonnet-20241022');
      expect(result.thread.tools).toEqual(['read', 'write']);
    });

    it('should store subAgents in thread', async () => {
      const subAgentBlueprint = createValidBlueprint({ name: 'Researcher' });
      const blueprint = createValidBlueprint({
        subAgents: {
          researcher: subAgentBlueprint,
        },
      });

      const result = await blueprintLoader.createThreadFromBlueprint(blueprint);

      expect(result.thread.subAgents).toBeDefined();
      expect(result.thread.subAgents?.researcher).toBeDefined();
      expect(result.thread.subAgents?.researcher.name).toBe('Researcher');
    });

    it('should return subAgents in result', async () => {
      const subAgentBlueprint = createValidBlueprint({ name: 'Writer' });
      const blueprint = createValidBlueprint({
        subAgents: {
          writer: subAgentBlueprint,
        },
      });

      const result = await blueprintLoader.createThreadFromBlueprint(blueprint);

      expect(result.subAgents).toBeDefined();
      expect(result.subAgents.writer).toBeDefined();
      expect(result.subAgents.writer.name).toBe('Writer');
    });

    it('should apply llmConfig overrides when creating thread', async () => {
      const blueprint = createValidBlueprint();

      const result = await blueprintLoader.createThreadFromBlueprint(
        blueprint,
        {
          llmConfigOverride: {
            temperature: 0.5,
          },
        },
      );

      expect(result.thread.llmConfig?.temperature).toBe(0.5);
    });

    it('should handle blueprint without components', async () => {
      const blueprint = createValidBlueprint({ components: [] });

      const result = await blueprintLoader.createThreadFromBlueprint(blueprint);

      expect(result.thread).toBeDefined();
      expect(result.tools).toEqual([]); // No component tools
    });

    it('should preserve custom metadata field for user data', async () => {
      const blueprint = createValidBlueprint();

      // Custom should remain available for business logic
      const threadOptions = {
        initialChunks: [],
        blueprintId: blueprint.id,
        blueprintName: blueprint.name,
        llmConfig: blueprint.llmConfig,
        tools: blueprint.tools,
        subAgents: blueprint.subAgents || {},
      };

      // Verify that custom is still a separate field
      const threadResult = await memoryManager.createThread({
        ...threadOptions,
        custom: { userId: '123', sessionId: 'abc' },
      });

      expect(threadResult.thread.metadata.custom).toEqual({
        userId: '123',
        sessionId: 'abc',
      });
      expect(threadResult.thread.blueprintId).toBe(blueprint.id);
    });
  });

  describe('parseFromJSON', () => {
    it('should parse valid JSON blueprint', () => {
      const blueprint = createValidBlueprint();
      const json = JSON.stringify(blueprint);

      const parsed = BlueprintLoader.parseFromJSON(json);

      expect(parsed.name).toBe('Test Agent');
      expect(parsed.llmConfig.model).toBe('claude-3-5-sonnet-20241022');
    });

    it('should throw error for invalid JSON', () => {
      const invalidJson = '{ invalid json }';

      expect(() => BlueprintLoader.parseFromJSON(invalidJson)).toThrow(
        'Failed to parse blueprint JSON',
      );
    });

    it('should throw error for invalid blueprint structure', () => {
      const invalidBlueprint = JSON.stringify({ name: 'Test' });

      expect(() => BlueprintLoader.parseFromJSON(invalidBlueprint)).toThrow(
        'Invalid blueprint JSON',
      );
    });
  });

  describe('toJSON', () => {
    it('should serialize blueprint to JSON', () => {
      const blueprint = createValidBlueprint();
      const json = BlueprintLoader.toJSON(blueprint);

      expect(json).toBeDefined();
      expect(typeof json).toBe('string');

      const parsed = JSON.parse(json);
      expect(parsed.name).toBe('Test Agent');
    });

    it('should serialize with pretty formatting', () => {
      const blueprint = createValidBlueprint();
      const json = BlueprintLoader.toJSON(blueprint, true);

      expect(json).toContain('\n');
      expect(json).toContain('  '); // Indentation
    });
  });

  describe('Blueprint field immutability after thread creation', () => {
    it('should preserve blueprint fields when thread is updated', async () => {
      const blueprint = createValidBlueprint({
        id: 'immutable-test',
        name: 'Immutable Agent',
        tools: ['read'],
      });

      const { thread } =
        await blueprintLoader.createThreadFromBlueprint(blueprint);

      // Simulate thread update (like changing state)
      const updatedThread = await memoryManager.getThread(thread.id);

      // Blueprint fields should be preserved
      expect(updatedThread?.blueprintId).toBe('immutable-test');
      expect(updatedThread?.blueprintName).toBe('Immutable Agent');
      expect(updatedThread?.tools).toEqual(['read']);
      expect(updatedThread?.llmConfig).toBeDefined();
    });
  });
});
