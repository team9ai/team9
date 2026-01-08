/**
 * Unit tests for context module
 */
import { ChunkType, ChunkContentType, MemoryChunk } from '../../types/index.js';
import { createChunk, createState } from '../../factories/index.js';
import {
  createContextBuilder,
  getDefaultRenderers,
} from '../../context/index.js';
import { createTokenizer } from '../../tokenizer/index.js';

describe('Context Module', () => {
  describe('ContextBuilder', () => {
    it('should build context with empty state', () => {
      const builder = createContextBuilder();
      const state = createState({ threadId: 'thread_1' });

      const result = builder.build(state);

      expect(result.messages.length).toBe(0);
      expect(result.includedChunkIds.length).toBe(0);
    });

    it('should build context with system prompt', () => {
      const builder = createContextBuilder();
      const state = createState({ threadId: 'thread_1' });

      const result = builder.build(state, {
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.messages.length).toBe(1);
      expect(result.messages[0].role).toBe('system');
      expect(result.messages[0].content).toContain('helpful assistant');
    });

    it('should build context with chunks', () => {
      const builder = createContextBuilder();

      const chunk1 = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Hello', role: 'user' },
      });
      const chunk2 = createChunk({
        type: ChunkType.AGENT,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Hi there',
          role: 'assistant',
        },
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [chunk1, chunk2],
      });

      const result = builder.build(state);

      expect(result.messages.length).toBe(2);
      expect(result.includedChunkIds.length).toBe(2);
    });

    it('should render XML tags correctly', () => {
      const builder = createContextBuilder();

      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Test message',
          role: 'user',
        },
      });

      const state = createState({ threadId: 'thread_1', chunks: [chunk] });
      const result = builder.build(state);

      const content = result.messages[0].content;
      expect(content).toContain('<user_message');
      expect(content).toContain('</user_message>');
      expect(content).toContain(`id="${chunk.id}"`);
    });

    it('should respect token limit', () => {
      const builder = createContextBuilder();

      const chunks: Readonly<MemoryChunk>[] = [];
      for (let i = 0; i < 10; i++) {
        chunks.push(
          createChunk({
            type: ChunkType.AGENT,
            content: {
              type: ChunkContentType.TEXT,
              text: `This is message ${i} with some content to increase token count.`,
              role: 'user',
            },
          }),
        );
      }

      const state = createState({ threadId: 'thread_1', chunks });

      const result = builder.build(state, { maxTokens: 50 });

      expect(result.excludedChunkIds.length).toBeGreaterThan(0);
      expect(result.tokenCount).toBeLessThanOrEqual(50);
    });

    it('should use tokenizer for exact counting', () => {
      const tokenizer = createTokenizer('gpt-4o');
      const builder = createContextBuilder(tokenizer);

      const state = createState({ threadId: 'thread_1' });
      const result = builder.build(state, {
        systemPrompt: 'You are a helpful assistant.',
      });

      expect(result.tokenCountExact).toBe(true);
    });

    it('should exclude chunk types', () => {
      const builder = createContextBuilder();

      const chunk1 = createChunk({
        type: ChunkType.AGENT,
        content: {
          type: ChunkContentType.TEXT,
          text: 'User message',
          role: 'user',
        },
      });
      const chunk2 = createChunk({
        type: ChunkType.THINKING,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Thinking...',
          action: 'thinking',
        },
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [chunk1, chunk2],
      });

      const result = builder.build(state, {
        excludeTypes: [ChunkType.THINKING],
      });

      expect(result.includedChunkIds).not.toContain(chunk2.id);
      expect(result.includedChunkIds).toContain(chunk1.id);
    });

    it('should include only specific chunks', () => {
      const builder = createContextBuilder();

      const chunk1 = createChunk({
        type: ChunkType.AGENT,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Message 1',
          role: 'user',
        },
      });
      const chunk2 = createChunk({
        type: ChunkType.AGENT,
        content: {
          type: ChunkContentType.TEXT,
          text: 'Message 2',
          role: 'user',
        },
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [chunk1, chunk2],
      });

      const result = builder.build(state, {
        includeOnlyChunkIds: [chunk1.id],
      });

      expect(result.includedChunkIds.length).toBe(1);
      expect(result.includedChunkIds[0]).toBe(chunk1.id);
    });

    it('should group consecutive same-role chunks', () => {
      const builder = createContextBuilder();

      const chunks = [
        createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'First',
            role: 'user',
          },
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Second',
            role: 'user',
          },
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Reply',
            role: 'assistant',
          },
        }),
      ];

      const state = createState({ threadId: 'thread_1', chunks });

      const result = builder.build(state);

      expect(result.messages.length).toBe(2);
      expect(result.messages[0].role).toBe('user');
      expect(result.messages[1].role).toBe('assistant');
    });
  });

  describe('Chunk Renderers', () => {
    it('should have renderers for all chunk types', () => {
      const renderers = getDefaultRenderers();

      const testChunks = [
        createChunk({
          type: ChunkType.SYSTEM,
          content: { type: ChunkContentType.TEXT, text: 'System' },
        }),
        createChunk({
          type: ChunkType.AGENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Agent',
            role: 'user',
          },
        }),
        createChunk({
          type: ChunkType.WORKFLOW,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Workflow',
            action: 'tool_call',
          },
        }),
        createChunk({
          type: ChunkType.DELEGATION,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Delegation',
            action: 'spawn',
          },
        }),
        createChunk({
          type: ChunkType.ENVIRONMENT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Environment',
            source: 'tool',
          },
        }),
        createChunk({
          type: ChunkType.THINKING,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Thinking content',
            action: 'thinking',
          },
        }),
        createChunk({
          type: ChunkType.OUTPUT,
          content: {
            type: ChunkContentType.TEXT,
            text: 'Output',
            action: 'completed',
          },
        }),
      ];

      for (const chunk of testChunks) {
        const renderer = renderers.find((r) => r.canRender(chunk));
        expect(renderer).toBeDefined();

        const rendered = renderer!.render(chunk);
        expect(rendered).toContain(chunk.id);
      }
    });

    it('should support custom renderer registration', () => {
      const builder = createContextBuilder();

      builder.registerRenderer({
        canRender: (chunk) => chunk.metadata.custom?.isCustom === true,
        getRole: () => 'assistant',
        render: (chunk) => `<custom id="${chunk.id}">Custom content</custom>`,
      });

      const customChunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: 'Test' },
        custom: { isCustom: true },
      });

      const state = createState({
        threadId: 'thread_1',
        chunks: [customChunk],
      });
      const result = builder.build(state);

      expect(result.messages[0].content).toContain('<custom');
    });
  });

  describe('Edge Cases', () => {
    it('should handle chunks with complex content', () => {
      const builder = createContextBuilder();

      const chunk = createChunk({
        type: ChunkType.WORKFLOW,
        content: {
          type: ChunkContentType.TEXT,
          action: 'tool_call',
          toolName: 'complex_tool',
          arguments: {
            nested: { deeply: { value: 'test' } },
            array: [1, 2, 3],
          },
        },
      });

      const state = createState({ threadId: 'thread_1', chunks: [chunk] });
      const result = builder.build(state);

      expect(result.messages.length).toBe(1);
    });

    it('should handle empty content', () => {
      const builder = createContextBuilder();

      const chunk = createChunk({
        type: ChunkType.AGENT,
        content: { type: ChunkContentType.TEXT, text: '', role: 'user' },
      });

      const state = createState({ threadId: 'thread_1', chunks: [chunk] });
      const result = builder.build(state);

      expect(result.messages.length).toBe(1);
    });
  });
});
