import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ClawHiveService } from '@team9/claw-hive';
import {
  DATABASE_CONNECTION,
  and,
  desc,
  eq,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { CreateTaskRunDto } from './dto/create-task-run.dto.js';
import type { UpdateTaskRunDto } from './dto/update-task-run.dto.js';
import { ImWorkerGrpcClientService } from '../im/services/im-worker-grpc-client.service.js';
import { TaskCastService } from '../routines/taskcast.service.js';
import { TaskTitleGeneratorService } from './task-title-generator.service.js';

const TASK_RUN_LIST_LIMIT = 200;
const STARTABLE_STATUSES: schema.TaskRunStatus[] = ['draft', 'upcoming'];
const TERMINAL_STATUSES: schema.TaskRunStatus[] = [
  'completed',
  'failed',
  'stopped',
  'timeout',
];

interface StartTaskRunDto {
  message?: string;
}

type TaskRunForStart = Pick<
  schema.TaskRun,
  | 'id'
  | 'tenantId'
  | 'routineId'
  | 'routineVersion'
  | 'botId'
  | 'creatorId'
  | 'title'
  | 'description'
  | 'status'
  | 'channelId'
  | 'taskcastTaskId'
  | 'startedAt'
>;

type BotExecutionTarget = {
  userId: string;
  managedProvider: string | null;
  managedMeta: schema.ManagedMeta | null;
};

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly clawHive: ClawHiveService,
    private readonly imWorkerGrpc: ImWorkerGrpcClientService,
    private readonly taskCastService: TaskCastService,
    @Optional()
    private readonly taskTitleGenerator?: TaskTitleGeneratorService,
  ) {}

  async create(dto: CreateTaskRunDto, userId: string, tenantId: string) {
    const runId = uuidv7();
    const channelId = uuidv7();
    const initialStatus: schema.TaskRunStatus =
      dto.triggerMode === 'create_only' ? 'draft' : 'upcoming';

    await this.db.insert(schema.channels).values({
      id: channelId,
      tenantId,
      name: `task-${dto.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-${channelId.slice(-6)}`,
      type: 'task',
      createdBy: userId,
    });

    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId,
      role: 'owner',
    });

    if (dto.botId) {
      const [bot] = await this.db
        .select({ userId: schema.bots.userId })
        .from(schema.bots)
        .where(eq(schema.bots.id, dto.botId))
        .limit(1);

      if (bot) {
        await this.db.insert(schema.channelMembers).values({
          id: uuidv7(),
          channelId,
          userId: bot.userId,
          role: 'member',
        });
      }
    }

    const [run] = await this.db
      .insert(schema.taskRuns)
      .values({
        id: runId,
        tenantId,
        routineId: null,
        routineVersion: null,
        botId: dto.botId ?? null,
        creatorId: userId,
        title: dto.title,
        description: dto.description ?? null,
        status: initialStatus,
        channelId,
      })
      .returning();

    this.queueTitleGeneration(run);

    if (this.shouldStartImmediately(dto)) {
      return this.start(run.id, userId, tenantId, {
        message: dto.description ?? dto.title,
      });
    }

    return run;
  }

  async start(
    runId: string,
    userId: string,
    tenantId: string,
    dto: StartTaskRunDto = {},
  ) {
    const run = await this.getRunForStartOrThrow(runId, tenantId, userId);

    if (run.status === 'in_progress') {
      return run;
    }

    if (TERMINAL_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        `Cannot start task run in ${run.status} status`,
      );
    }

    if (!STARTABLE_STATUSES.includes(run.status)) {
      throw new BadRequestException(
        `Cannot start task run in ${run.status} status`,
      );
    }

    if (!run.botId) {
      throw new BadRequestException(
        'Cannot start task run without an assigned bot',
      );
    }

    const bot = await this.getBotExecutionTarget(run.botId);
    if (!bot) {
      throw new BadRequestException(`Bot ${run.botId} not found`);
    }

    const channelId =
      run.channelId ?? (await this.createTaskChannel(run, bot.userId));
    const taskcastTaskId =
      run.taskcastTaskId ??
      (await this.taskCastService.createTask({
        routineId: run.routineId ?? run.id,
        executionId: run.id,
        botId: run.botId,
        tenantId,
        ttl: 86400,
      }));
    const now = new Date();
    const [updatedRun] = await this.db
      .update(schema.taskRuns)
      .set({
        status: 'in_progress',
        channelId,
        taskcastTaskId,
        startedAt: run.startedAt ?? now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.taskRuns.id, run.id),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .returning();

    const activeRun = updatedRun ?? {
      ...run,
      status: 'in_progress' as const,
      channelId,
      taskcastTaskId,
      startedAt: run.startedAt ?? now,
      updatedAt: now,
    };
    const message = dto.message?.trim() || run.description?.trim() || run.title;

    await this.createInitialUserMessage({
      channelId,
      senderId: userId,
      tenantId,
      message,
    });

    await this.startHiveTaskSession({
      run: activeRun,
      bot,
      channelId,
      tenantId,
      userId,
      message,
    });

    return activeRun;
  }

  async list(tenantId: string, userId: string) {
    return this.db
      .select()
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.tenantId, tenantId),
          eq(schema.taskRuns.creatorId, userId),
        ),
      )
      .orderBy(desc(schema.taskRuns.createdAt))
      .limit(TASK_RUN_LIST_LIMIT);
  }

  async getById(runId: string, tenantId: string, userId: string) {
    const [run] = await this.db
      .select()
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
          eq(schema.taskRuns.creatorId, userId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    const deliverables = await this.db
      .select()
      .from(schema.taskDeliverables)
      .where(eq(schema.taskDeliverables.runId, run.id))
      .orderBy(desc(schema.taskDeliverables.createdAt));

    return { ...run, deliverables };
  }

  async getDeliverables(runId: string, tenantId: string) {
    await this.getRunOrThrow(runId, tenantId);

    return this.db
      .select()
      .from(schema.taskDeliverables)
      .where(eq(schema.taskDeliverables.runId, runId))
      .orderBy(desc(schema.taskDeliverables.createdAt));
  }

  async update(
    runId: string,
    dto: UpdateTaskRunDto,
    userId: string,
    tenantId: string,
  ) {
    const run = await this.getRunForMutationOrThrow(runId, userId, tenantId);
    const updateData: Partial<schema.NewTaskRun> = {};

    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) {
        throw new BadRequestException('Task title cannot be empty');
      }
      updateData.title = title;
    }

    if (Object.keys(updateData).length === 0) {
      return run;
    }

    const [updated] = await this.db
      .update(schema.taskRuns)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .returning();

    return updated ?? { ...run, ...updateData, updatedAt: new Date() };
  }

  async hide(runId: string, userId: string, tenantId: string) {
    await this.getRunForMutationOrThrow(runId, userId, tenantId);
    const now = new Date();

    const [updated] = await this.db
      .update(schema.taskRuns)
      .set({
        hiddenAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .returning();

    return updated;
  }

  async unhide(runId: string, userId: string, tenantId: string) {
    await this.getRunForMutationOrThrow(runId, userId, tenantId);

    const [updated] = await this.db
      .update(schema.taskRuns)
      .set({
        hiddenAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .returning();

    return updated;
  }

  async archive(runId: string, userId: string, tenantId: string) {
    await this.getRunForMutationOrThrow(runId, userId, tenantId);
    const now = new Date();

    const [updated] = await this.db
      .update(schema.taskRuns)
      .set({
        archivedAt: now,
        hiddenAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .returning();

    return updated;
  }

  async activate(runId: string, userId: string, tenantId: string) {
    await this.getRunForMutationOrThrow(runId, userId, tenantId);
    const now = new Date();

    const [updated] = await this.db
      .update(schema.taskRuns)
      .set({
        archivedAt: null,
        hiddenAt: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .returning();

    return updated;
  }

  async delete(runId: string, userId: string, tenantId: string) {
    await this.getRunForMutationOrThrow(runId, userId, tenantId);

    await this.db
      .delete(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      );

    return { success: true };
  }

  private async getRunOrThrow(runId: string, tenantId: string) {
    const [run] = await this.db
      .select({ id: schema.taskRuns.id })
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    return run;
  }

  private async getRunForMutationOrThrow(
    runId: string,
    userId: string,
    tenantId: string,
  ) {
    const [run] = await this.db
      .select()
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    if (run.creatorId !== userId) {
      throw new ForbiddenException('Cannot modify another user task run');
    }

    return run;
  }

  private shouldStartImmediately(dto: CreateTaskRunDto): boolean {
    return dto.executeImmediately === true || dto.triggerMode === 'immediate';
  }

  private queueTitleGeneration(run: schema.TaskRun): void {
    void this.taskTitleGenerator
      ?.generateForRun({
        runId: run.id,
        expectedCurrentTitle: run.title,
      })
      .catch((err) => {
        this.logger.warn(`Queued task title generation failed: ${err}`);
      });
  }

  private async getRunForStartOrThrow(
    runId: string,
    tenantId: string,
    userId: string,
  ) {
    const [run] = await this.db
      .select()
      .from(schema.taskRuns)
      .where(
        and(
          eq(schema.taskRuns.id, runId),
          eq(schema.taskRuns.tenantId, tenantId),
          eq(schema.taskRuns.creatorId, userId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new NotFoundException('Task run not found');
    }

    return run as TaskRunForStart;
  }

  private async getBotExecutionTarget(
    botId: string,
  ): Promise<BotExecutionTarget | null> {
    const [bot] = await this.db
      .select({
        userId: schema.bots.userId,
        managedProvider: schema.bots.managedProvider,
        managedMeta: schema.bots.managedMeta,
      })
      .from(schema.bots)
      .where(eq(schema.bots.id, botId))
      .limit(1);

    return (bot as BotExecutionTarget | undefined) ?? null;
  }

  private async createTaskChannel(
    run: TaskRunForStart,
    botUserId: string,
  ): Promise<string> {
    const channelId = uuidv7();
    await this.db.insert(schema.channels).values({
      id: channelId,
      tenantId: run.tenantId,
      name: `task-${run.title.slice(0, 60).replace(/\s+/g, '-').toLowerCase()}-${channelId.slice(-6)}`,
      type: 'task',
      createdBy: run.creatorId,
    });

    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: run.creatorId,
      role: 'owner',
    });

    await this.db.insert(schema.channelMembers).values({
      id: uuidv7(),
      channelId,
      userId: botUserId,
      role: 'member',
    });

    return channelId;
  }

  private async createInitialUserMessage(params: {
    channelId: string;
    senderId: string;
    tenantId: string;
    message: string;
  }): Promise<void> {
    await this.imWorkerGrpc.createMessage({
      clientMsgId: uuidv7(),
      channelId: params.channelId,
      senderId: params.senderId,
      content: params.message,
      type: 'text',
      workspaceId: params.tenantId,
    });
  }

  private async startHiveTaskSession(params: {
    run: TaskRunForStart & {
      channelId: string | null;
      taskcastTaskId: string | null;
    };
    bot: BotExecutionTarget;
    channelId: string;
    tenantId: string;
    userId: string;
    message: string;
  }): Promise<void> {
    const { run, bot, channelId, tenantId, userId, message } = params;
    const agentId = bot.managedMeta?.agentId;
    if (bot.managedProvider !== 'hive' || !agentId) {
      this.logger.debug(
        `Task run ${run.id} started without Hive session; bot is not hive-managed`,
      );
      return;
    }

    const sessionId = `team9/${tenantId}/${agentId}/task/${run.id}`;
    await this.clawHive.createSession(
      agentId,
      {
        userId,
        sessionId,
        team9Context: {
          source: 'team9',
          scopeType: 'task',
          scopeId: run.id,
          taskId: run.id,
          executionId: run.id,
          channelId,
        },
      },
      tenantId,
    );

    await this.clawHive.sendInput(
      sessionId,
      {
        type: 'team9:task.start',
        source: 'team9',
        timestamp: new Date().toISOString(),
        payload: {
          taskId: run.id,
          executionId: run.id,
          channelId,
          title: run.title,
          description: run.description,
          message,
          location: { type: 'task', id: channelId },
          taskcastTaskId: run.taskcastTaskId,
        },
      },
      tenantId,
    );
  }
}
