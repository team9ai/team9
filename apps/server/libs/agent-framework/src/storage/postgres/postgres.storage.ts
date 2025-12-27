import { eq, and, gte, lte, asc, desc, inArray } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { MemoryChunk } from '../../types/chunk.types';
import { MemoryState } from '../../types/state.types';
import { MemoryThread } from '../../types/thread.types';
import { StorageProvider, ListStatesOptions } from '../storage.types';
import { memoryThreads, memoryChunks, memoryStates } from './schema';

/**
 * Serializable state data stored in JSONB
 */
interface StateData {
  id: string;
  threadId?: string;
  chunkIds: string[];
  metadata: MemoryState['metadata'];
}

/**
 * Convert MemoryState to a serializable format for JSONB
 */
function stateToData(state: MemoryState): StateData {
  return {
    id: state.id,
    threadId: state.threadId,
    chunkIds: [...state.chunkIds],
    metadata: {
      ...state.metadata,
      sourceOperation: state.metadata.sourceOperation,
    },
  };
}

/**
 * Convert stored data back to MemoryState
 */
async function dataToState(
  data: StateData,
  getChunks: (ids: string[]) => Promise<Map<string, MemoryChunk>>,
): Promise<MemoryState> {
  const chunks = await getChunks(data.chunkIds);
  return {
    id: data.id,
    threadId: data.threadId,
    chunkIds: data.chunkIds,
    chunks,
    metadata: data.metadata,
  };
}

/**
 * PostgreSQL implementation of StorageProvider
 * Uses JSONB for flexible data storage
 */
export class PostgresStorageProvider implements StorageProvider {
  constructor(private db: PostgresJsDatabase<Record<string, never>>) {}

  // ============ Thread Operations ============

  async saveThread(thread: MemoryThread): Promise<void> {
    await this.db.insert(memoryThreads).values({
      id: thread.id,
      data: thread,
    });
  }

  async getThread(threadId: string): Promise<MemoryThread | null> {
    const rows = await this.db
      .select()
      .from(memoryThreads)
      .where(eq(memoryThreads.id, threadId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0].data as MemoryThread;
  }

  async updateThread(thread: MemoryThread): Promise<void> {
    await this.db
      .update(memoryThreads)
      .set({
        data: thread,
      })
      .where(eq(memoryThreads.id, thread.id));
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.db.delete(memoryThreads).where(eq(memoryThreads.id, threadId));
  }

  // ============ Chunk Operations ============

  async saveChunk(chunk: MemoryChunk): Promise<void> {
    await this.db.insert(memoryChunks).values({
      id: chunk.id,
      data: chunk,
    });
  }

  async saveChunks(chunks: MemoryChunk[]): Promise<void> {
    if (chunks.length === 0) return;

    await this.db.insert(memoryChunks).values(
      chunks.map((chunk) => ({
        id: chunk.id,
        data: chunk,
      })),
    );
  }

  async getChunk(chunkId: string): Promise<MemoryChunk | null> {
    const rows = await this.db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.id, chunkId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    return rows[0].data as MemoryChunk;
  }

  async getChunks(chunkIds: string[]): Promise<Map<string, MemoryChunk>> {
    if (chunkIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .select()
      .from(memoryChunks)
      .where(inArray(memoryChunks.id, chunkIds));

    const result = new Map<string, MemoryChunk>();
    for (const row of rows) {
      const chunk = row.data as MemoryChunk;
      result.set(chunk.id, chunk);
    }

    return result;
  }

  async getChunksByThread(threadId: string): Promise<MemoryChunk[]> {
    const rows = await this.db
      .select()
      .from(memoryChunks)
      .where(eq(memoryChunks.threadId, threadId))
      .orderBy(asc(memoryChunks.createdAt));

    return rows.map((row) => row.data as MemoryChunk);
  }

  async deleteChunk(chunkId: string): Promise<void> {
    await this.db.delete(memoryChunks).where(eq(memoryChunks.id, chunkId));
  }

  // ============ State Operations ============

  async saveState(state: MemoryState): Promise<void> {
    const data = stateToData(state);

    await this.db.insert(memoryStates).values({
      id: state.id,
      data,
    });
  }

  async getState(stateId: string): Promise<MemoryState | null> {
    const rows = await this.db
      .select()
      .from(memoryStates)
      .where(eq(memoryStates.id, stateId))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const data = rows[0].data as StateData;
    return dataToState(data, (ids) => this.getChunks(ids));
  }

  async getInitialState(threadId: string): Promise<MemoryState | null> {
    const rows = await this.db
      .select()
      .from(memoryStates)
      .where(eq(memoryStates.threadId, threadId))
      .orderBy(asc(memoryStates.createdAt))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const data = rows[0].data as StateData;
    return dataToState(data, (ids) => this.getChunks(ids));
  }

  async getLatestState(threadId: string): Promise<MemoryState | null> {
    const rows = await this.db
      .select()
      .from(memoryStates)
      .where(eq(memoryStates.threadId, threadId))
      .orderBy(desc(memoryStates.createdAt))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const data = rows[0].data as StateData;
    return dataToState(data, (ids) => this.getChunks(ids));
  }

  async getStatesByThread(threadId: string): Promise<MemoryState[]> {
    const rows = await this.db
      .select()
      .from(memoryStates)
      .where(eq(memoryStates.threadId, threadId))
      .orderBy(asc(memoryStates.createdAt));

    const states: MemoryState[] = [];
    for (const row of rows) {
      const data = row.data as StateData;
      const state = await dataToState(data, (ids) => this.getChunks(ids));
      states.push(state);
    }

    return states;
  }

  async listStates(options?: ListStatesOptions): Promise<MemoryState[]> {
    const conditions: ReturnType<typeof eq>[] = [];

    if (options?.threadId) {
      conditions.push(eq(memoryStates.threadId, options.threadId));
    }
    if (options?.fromTimestamp !== undefined) {
      conditions.push(
        gte(memoryStates.createdAt, new Date(options.fromTimestamp)),
      );
    }
    if (options?.toTimestamp !== undefined) {
      conditions.push(
        lte(memoryStates.createdAt, new Date(options.toTimestamp)),
      );
    }

    let query = this.db
      .select()
      .from(memoryStates)
      .orderBy(asc(memoryStates.createdAt));

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as typeof query;
    }

    if (options?.limit) {
      query = query.limit(options.limit) as typeof query;
    }
    if (options?.offset) {
      query = query.offset(options.offset) as typeof query;
    }

    const rows = await query;

    const states: MemoryState[] = [];
    for (const row of rows) {
      const data = row.data as StateData;
      const state = await dataToState(data, (ids) => this.getChunks(ids));
      states.push(state);
    }

    return states;
  }

  async deleteState(stateId: string): Promise<void> {
    await this.db.delete(memoryStates).where(eq(memoryStates.id, stateId));
  }

  // ============ Transaction Support ============

  async transaction<T>(
    fn: (provider: StorageProvider) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const txProvider = new PostgresStorageProvider(
        tx as unknown as PostgresJsDatabase<Record<string, never>>,
      );
      return fn(txProvider);
    });
  }

  // ============ Lifecycle ============

  async initialize(): Promise<void> {
    // Tables should be created via migrations
  }

  async close(): Promise<void> {
    // Connection is managed externally
  }
}
