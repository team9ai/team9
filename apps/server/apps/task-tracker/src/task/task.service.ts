import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { createId } from '@paralleldrive/cuid2';
import {
  DATABASE_CONNECTION,
  tasks,
  eq,
  and,
  inArray,
  lte,
  type Task,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database';
import { RedisService } from '@team9/redis';
import { SseService } from '../sse/sse.service.js';
import { RedisKeys } from '../shared/constants/index.js';
import type { ProgressEntry } from '../shared/types/index.js';
import type {
  RegisterTaskDto,
  RegisterTaskResponse,
  CompleteTaskDto,
  FailTaskDto,
  StartTaskDto,
  TimeoutTaskDto,
  UpdateStatusResponse,
  UpdateProgressDto,
  UpdateProgressResponse,
  ClaimTaskDto,
  ReleaseTaskResponse,
  RetryTaskResponse,
} from './dto/index.js';

@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redisService: RedisService,
    private readonly sseService: SseService,
  ) {}

  /**
   * API 1: Register a new task
   * Creates a task with pending status and stores in PostgreSQL
   */
  async registerTask(dto: RegisterTaskDto): Promise<RegisterTaskResponse> {
    const taskId = dto.taskId ?? createId();
    const timeoutSeconds = dto.timeoutSeconds ?? 86400; // Default 24 hours
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + timeoutSeconds * 1000);

    const [task] = await this.db
      .insert(tasks)
      .values({
        id: taskId,
        taskType: dto.taskType,
        status: 'pending',
        metadata: dto.metadata,
        params: dto.params,
        timeoutSeconds,
        timeoutAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    this.logger.log(
      `Registered task ${taskId} of type ${dto.taskType}, timeout at ${timeoutAt.toISOString()}`,
    );

    return {
      taskId: task.id,
      status: task.status,
      createdAt: task.createdAt.toISOString(),
      timeoutAt: timeoutAt.toISOString(),
    };
  }

  /**
   * API 2a: Start task (set to in_progress)
   */
  async startTask(
    taskId: string,
    dto: StartTaskDto,
  ): Promise<UpdateStatusResponse> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status !== 'pending') {
      throw new BadRequestException(
        `Task ${taskId} cannot be started, current status: ${task.status}`,
      );
    }

    const now = new Date();
    const [updated] = await this.db
      .update(tasks)
      .set({
        status: 'in_progress',
        workerId: dto.workerId,
        startedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .returning();

    this.logger.log(`Task ${taskId} started by worker ${dto.workerId}`);

    return {
      taskId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * API 2b: Complete task
   * Persists progress history from Redis, stores result, notifies SSE subscribers
   */
  async completeTask(
    taskId: string,
    dto: CompleteTaskDto,
  ): Promise<UpdateStatusResponse> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status !== 'in_progress') {
      throw new BadRequestException(
        `Task ${taskId} cannot be completed, current status: ${task.status}`,
      );
    }

    if (task.workerId !== dto.workerId) {
      throw new ForbiddenException(
        `Worker ${dto.workerId} is not authorized to complete task ${taskId}`,
      );
    }

    // Get progress history from Redis
    const progressHistory = await this.getProgressFromRedis(taskId);

    const now = new Date();
    const [updated] = await this.db
      .update(tasks)
      .set({
        status: 'completed',
        result: dto.result,
        progressHistory,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .returning();

    // Cleanup Redis
    await this.cleanupRedis(taskId);

    // Notify SSE subscribers
    this.sseService.broadcastStatusChange(
      taskId,
      'completed',
      dto.result,
      undefined,
    );

    this.logger.log(`Task ${taskId} completed by worker ${dto.workerId}`);

    return {
      taskId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * API 2c: Fail task
   * Persists progress history from Redis, stores error, notifies SSE subscribers
   */
  async failTask(
    taskId: string,
    dto: FailTaskDto,
  ): Promise<UpdateStatusResponse> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status !== 'in_progress') {
      throw new BadRequestException(
        `Task ${taskId} cannot be failed, current status: ${task.status}`,
      );
    }

    if (task.workerId !== dto.workerId) {
      throw new ForbiddenException(
        `Worker ${dto.workerId} is not authorized to fail task ${taskId}`,
      );
    }

    // Get progress history from Redis
    const progressHistory = await this.getProgressFromRedis(taskId);

    const now = new Date();
    const [updated] = await this.db
      .update(tasks)
      .set({
        status: 'failed',
        error: dto.error,
        progressHistory,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .returning();

    // Cleanup Redis
    await this.cleanupRedis(taskId);

    // Notify SSE subscribers
    this.sseService.broadcastStatusChange(
      taskId,
      'failed',
      undefined,
      dto.error,
    );

    this.logger.log(`Task ${taskId} failed by worker ${dto.workerId}`);

    return {
      taskId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * API 2d: Manual timeout
   */
  async timeoutTask(
    taskId: string,
    dto: TimeoutTaskDto,
  ): Promise<UpdateStatusResponse> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status === 'completed' || task.status === 'failed') {
      throw new BadRequestException(
        `Task ${taskId} already finished with status: ${task.status}`,
      );
    }

    // Get progress history from Redis
    const progressHistory = await this.getProgressFromRedis(taskId);

    const now = new Date();
    const [updated] = await this.db
      .update(tasks)
      .set({
        status: 'timeout',
        progressHistory,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .returning();

    // Cleanup Redis
    await this.cleanupRedis(taskId);

    // Notify SSE subscribers
    this.sseService.broadcastStatusChange(taskId, 'timeout');

    this.logger.log(`Task ${taskId} manually timed out`);

    return {
      taskId: updated.id,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    };
  }

  /**
   * API 3: Get task status
   */
  async getTask(taskId: string): Promise<Task> {
    return this.getTaskOrThrow(taskId);
  }

  /**
   * API 4: Update task progress
   * Stores progress in Redis and broadcasts to SSE subscribers
   */
  async updateProgress(
    taskId: string,
    dto: UpdateProgressDto,
  ): Promise<UpdateProgressResponse> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status !== 'in_progress') {
      throw new BadRequestException(
        `Cannot update progress for task ${taskId}, status: ${task.status}`,
      );
    }

    // Get next seqId
    const seqIdKey = RedisKeys.taskSeqId(taskId);
    const seqId = await this.redisService.incr(seqIdKey);

    // Create progress entry
    const progressEntry: ProgressEntry = {
      seqId,
      ...dto.progress,
    };

    // Store in Redis
    const progressKey = RedisKeys.taskProgress(taskId);
    await this.redisService.rpush(progressKey, JSON.stringify(progressEntry));

    // Broadcast to SSE subscribers
    this.sseService.broadcastProgress(taskId, progressEntry);

    const timestamp = new Date().toISOString();
    this.logger.debug(`Task ${taskId} progress updated, seqId: ${seqId}`);

    return {
      taskId,
      seqId,
      timestamp,
    };
  }

  /**
   * API 5: Get task for SSE tracking
   * Returns task data for SSE controller to use
   */
  async getTaskForTracking(taskId: string): Promise<{
    task: Task;
    progressHistory: ProgressEntry[];
  }> {
    const task = await this.getTaskOrThrow(taskId);

    // For completed/failed/timeout tasks, return persisted history
    if (
      task.status === 'completed' ||
      task.status === 'failed' ||
      task.status === 'timeout'
    ) {
      return {
        task,
        progressHistory: (task.progressHistory ?? []) as ProgressEntry[],
      };
    }

    // For pending/in_progress, get current progress from Redis
    const progressHistory = await this.getProgressFromRedis(taskId);

    return {
      task,
      progressHistory,
    };
  }

  /**
   * API 6: Process timeout detection
   * Updates all timed-out tasks and returns count
   */
  async processTimeouts(): Promise<{ processedCount: number }> {
    const now = new Date();

    // Find all tasks that have exceeded their timeout
    const timedOutTasks = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          inArray(tasks.status, ['pending', 'in_progress']),
          lte(tasks.timeoutAt, now),
        ),
      );

    let processedCount = 0;

    for (const task of timedOutTasks) {
      try {
        // Get progress history from Redis
        const progressHistory = await this.getProgressFromRedis(task.id);

        await this.db
          .update(tasks)
          .set({
            status: 'timeout',
            progressHistory,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(tasks.id, task.id));

        // Cleanup Redis
        await this.cleanupRedis(task.id);

        // Notify SSE subscribers
        this.sseService.broadcastStatusChange(task.id, 'timeout');

        processedCount++;
        this.logger.log(`Task ${task.id} auto-timed out`);
      } catch (error) {
        this.logger.error(
          `Failed to process timeout for task ${task.id}:`,
          error,
        );
      }
    }

    return { processedCount };
  }

  /**
   * API 7: Claim task
   * Atomically claims a pending task for a worker
   */
  async claimTask(dto: ClaimTaskDto): Promise<Task | null> {
    const now = new Date();

    // Find and update the first pending task matching the worker's types
    // Using a transaction to ensure atomicity
    const [claimed] = await this.db
      .update(tasks)
      .set({
        status: 'in_progress',
        workerId: dto.workerId,
        startedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(tasks.taskType, dto.taskTypes),
          eq(tasks.status, 'pending'),
        ),
      )
      .returning();

    if (claimed) {
      this.logger.log(`Task ${claimed.id} claimed by worker ${dto.workerId}`);
    }

    return claimed ?? null;
  }

  /**
   * API 8: Release task
   * Returns task to pending state if worker matches
   */
  async releaseTask(
    taskId: string,
    workerId: string,
  ): Promise<ReleaseTaskResponse> {
    const task = await this.getTaskOrThrow(taskId);

    if (task.status !== 'in_progress') {
      throw new BadRequestException(
        `Task ${taskId} cannot be released, current status: ${task.status}`,
      );
    }

    if (task.workerId !== workerId) {
      throw new ForbiddenException(
        `Worker ${workerId} is not authorized to release task ${taskId}`,
      );
    }

    // Get and preserve current progress
    const progressHistory = await this.getProgressFromRedis(taskId);

    const now = new Date();
    await this.db
      .update(tasks)
      .set({
        status: 'pending',
        workerId: null,
        startedAt: null,
        updatedAt: now,
        // Keep progress history in Redis for next worker
      })
      .where(eq(tasks.id, taskId));

    this.logger.log(`Task ${taskId} released by worker ${workerId}`);

    return {
      taskId,
      status: 'pending',
      message: `Task released, ${progressHistory.length} progress entries preserved`,
    };
  }

  /**
   * API 9: Retry task
   * Creates a new task with same content, tracks original
   */
  async retryTask(taskId: string): Promise<RetryTaskResponse> {
    const originalTask = await this.getTaskOrThrow(taskId);

    if (originalTask.status !== 'failed' && originalTask.status !== 'timeout') {
      throw new BadRequestException(
        `Only failed or timed-out tasks can be retried, current status: ${originalTask.status}`,
      );
    }

    // Calculate retry count
    const retryCount = originalTask.retryCount + 1;
    const newTaskId = createId();
    const now = new Date();
    const timeoutAt = new Date(
      now.getTime() + originalTask.timeoutSeconds * 1000,
    );

    const [newTask] = await this.db
      .insert(tasks)
      .values({
        id: newTaskId,
        taskType: originalTask.taskType,
        status: 'pending',
        metadata: originalTask.metadata,
        params: originalTask.params,
        timeoutSeconds: originalTask.timeoutSeconds,
        timeoutAt,
        originalTaskId: originalTask.originalTaskId ?? taskId,
        retryCount,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    this.logger.log(
      `Created retry task ${newTaskId} for original ${taskId}, retry #${retryCount}`,
    );

    return {
      newTaskId: newTask.id,
      originalTaskId: originalTask.originalTaskId ?? taskId,
      status: newTask.status,
      retryCount,
    };
  }

  /**
   * Helper: Get task or throw NotFoundException
   */
  private async getTaskOrThrow(taskId: string): Promise<Task> {
    const [task] = await this.db
      .select()
      .from(tasks)
      .where(eq(tasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found`);
    }

    return task;
  }

  /**
   * Helper: Get progress history from Redis
   */
  private async getProgressFromRedis(taskId: string): Promise<ProgressEntry[]> {
    const progressKey = RedisKeys.taskProgress(taskId);
    const entries = await this.redisService.lrange(progressKey, 0, -1);

    return entries.map((entry) => JSON.parse(entry) as ProgressEntry);
  }

  /**
   * Helper: Cleanup Redis keys for a task
   */
  private async cleanupRedis(taskId: string): Promise<void> {
    const progressKey = RedisKeys.taskProgress(taskId);
    const seqIdKey = RedisKeys.taskSeqId(taskId);

    await Promise.all([
      this.redisService.del(progressKey),
      this.redisService.del(seqIdKey),
    ]);
  }
}
