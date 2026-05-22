import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { ShortTitleGeneratorService } from '../common/ai/short-title-generator.service.js';
import { WebsocketGateway } from '../im/websocket/websocket.gateway.js';
import { WS_EVENTS } from '../im/websocket/events/events.constants.js';

const TASK_TITLE_SEED_MAX_LENGTH = 800;

@Injectable()
export class TaskTitleGeneratorService {
  private readonly logger = new Logger(TaskTitleGeneratorService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    @Optional() private readonly titleGenerator?: ShortTitleGeneratorService,
    @Optional() private readonly ws?: WebsocketGateway,
  ) {}

  async generateForRun(params: {
    runId: string;
    expectedCurrentTitle?: string;
  }): Promise<schema.TaskRun | null> {
    if (!this.titleGenerator) return null;

    const [run] = await this.db
      .select()
      .from(schema.taskRuns)
      .where(eq(schema.taskRuns.id, params.runId))
      .limit(1);

    if (!run) return null;
    if (
      params.expectedCurrentTitle !== undefined &&
      run.title !== params.expectedCurrentTitle
    ) {
      return null;
    }

    const seed = (run.description?.trim() || run.title.trim()).slice(
      0,
      TASK_TITLE_SEED_MAX_LENGTH,
    );
    if (!seed) return null;

    let title: string | null = null;
    try {
      title = await this.titleGenerator.generate(seed, {
        userId: run.creatorId,
        tenantId: run.tenantId,
      });
    } catch (err) {
      this.logger.warn(`Task title generation failed for ${run.id}: ${err}`);
      return null;
    }

    if (!title || title === run.title) return null;

    const [updated] = await this.db
      .update(schema.taskRuns)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(schema.taskRuns.id, run.id),
          eq(schema.taskRuns.tenantId, run.tenantId),
          params.expectedCurrentTitle !== undefined
            ? eq(schema.taskRuns.title, params.expectedCurrentTitle)
            : undefined,
        ),
      )
      .returning();

    if (!updated) return null;

    await this.ws?.sendToUser(run.creatorId, WS_EVENTS.TASK.UPDATED, {
      taskId: run.id,
      title,
    });

    return updated;
  }
}
