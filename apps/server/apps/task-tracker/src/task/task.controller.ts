import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  Sse,
  Logger,
  MessageEvent,
} from '@nestjs/common';
import { Observable, Subject, from, switchMap, finalize } from 'rxjs';
import { TaskService } from './task.service.js';
import { SseService } from '../sse/sse.service.js';
import { SseEventType } from '../shared/types/index.js';
import type { Task } from '@team9/database';
import type {
  RegisterTaskDto,
  RegisterTaskResponse,
  StartTaskDto,
  CompleteTaskDto,
  FailTaskDto,
  TimeoutTaskDto,
  UpdateStatusResponse,
  UpdateProgressDto,
  UpdateProgressResponse,
  ClaimTaskDto,
  ReleaseTaskDto,
  ReleaseTaskResponse,
  RetryTaskResponse,
} from './dto/index.js';

@Controller({ path: 'tasks', version: '1' })
export class TaskController {
  private readonly logger = new Logger(TaskController.name);

  constructor(
    private readonly taskService: TaskService,
    private readonly sseService: SseService,
  ) {}

  /**
   * API 1: Register a new task
   * POST /api/v1/tasks
   */
  @Post()
  async registerTask(
    @Body() dto: RegisterTaskDto,
  ): Promise<RegisterTaskResponse> {
    return this.taskService.registerTask(dto);
  }

  /**
   * API 2a: Start task (set status to in_progress)
   * POST /api/v1/tasks/:taskId/start
   */
  @Post(':taskId/start')
  async startTask(
    @Param('taskId') taskId: string,
    @Body() dto: StartTaskDto,
  ): Promise<UpdateStatusResponse> {
    return this.taskService.startTask(taskId, dto);
  }

  /**
   * API 2b: Complete task
   * POST /api/v1/tasks/:taskId/complete
   */
  @Post(':taskId/complete')
  async completeTask(
    @Param('taskId') taskId: string,
    @Body() dto: CompleteTaskDto,
  ): Promise<UpdateStatusResponse> {
    return this.taskService.completeTask(taskId, dto);
  }

  /**
   * API 2c: Fail task
   * POST /api/v1/tasks/:taskId/fail
   */
  @Post(':taskId/fail')
  async failTask(
    @Param('taskId') taskId: string,
    @Body() dto: FailTaskDto,
  ): Promise<UpdateStatusResponse> {
    return this.taskService.failTask(taskId, dto);
  }

  /**
   * API 2d: Manual timeout
   * POST /api/v1/tasks/:taskId/timeout
   */
  @Post(':taskId/timeout')
  async timeoutTask(
    @Param('taskId') taskId: string,
    @Body() dto: TimeoutTaskDto,
  ): Promise<UpdateStatusResponse> {
    return this.taskService.timeoutTask(taskId, dto);
  }

  /**
   * API 3: Get task status
   * GET /api/v1/tasks/:taskId
   */
  @Get(':taskId')
  async getTask(@Param('taskId') taskId: string): Promise<Task> {
    return this.taskService.getTask(taskId);
  }

  /**
   * API 4: Update task progress
   * POST /api/v1/tasks/:taskId/progress
   */
  @Post(':taskId/progress')
  async updateProgress(
    @Param('taskId') taskId: string,
    @Body() dto: UpdateProgressDto,
  ): Promise<UpdateProgressResponse> {
    return this.taskService.updateProgress(taskId, dto);
  }

  /**
   * API 5: Track task progress via SSE
   * GET /api/v1/tasks/:taskId/track
   *
   * Query params:
   * - afterSeqId: Only send progress entries after this seqId (skip earlier history)
   * - ignoreHistory: If true, skip all history and only receive new updates (for active tasks)
   *
   * Behavior:
   * - Streams progress entries as individual PROGRESS events
   * - For completed/failed/timeout tasks: streams history then STATUS_CHANGE then closes
   * - For pending/in_progress tasks: streams history (if any) then live updates
   */
  @Sse(':taskId/track')
  trackTask(
    @Param('taskId') taskId: string,
    @Query('afterSeqId') afterSeqIdParam?: string,
    @Query('ignoreHistory') ignoreHistoryParam?: string,
  ): Observable<MessageEvent> {
    const afterSeqId = afterSeqIdParam
      ? parseInt(afterSeqIdParam, 10)
      : undefined;
    const ignoreHistory = ignoreHistoryParam === 'true';

    return from(this.taskService.getTaskForTracking(taskId)).pipe(
      switchMap(({ task, progressHistory }) => {
        const responseSubject = new Subject<MessageEvent>();
        const isTerminal =
          task.status === 'completed' ||
          task.status === 'failed' ||
          task.status === 'timeout';

        // Filter history based on afterSeqId
        let filteredHistory = progressHistory;
        if (afterSeqId !== undefined) {
          filteredHistory = progressHistory.filter((p) => p.seqId > afterSeqId);
        } else if (ignoreHistory) {
          filteredHistory = [];
        }

        // Stream history as individual PROGRESS events
        if (filteredHistory.length > 0) {
          this.logger.debug(
            `Sending ${filteredHistory.length} history entries for task ${taskId}`,
          );
          for (const entry of filteredHistory) {
            responseSubject.next({
              data: {
                event: SseEventType.PROGRESS,
                data: entry,
                taskId,
                timestamp: new Date().toISOString(),
              },
            } as MessageEvent);
          }
        }

        // For terminal states, send final status and complete
        if (isTerminal) {
          this.logger.debug(
            `Task ${taskId} already finished with status ${task.status}`,
          );
          responseSubject.next({
            data: {
              event: SseEventType.STATUS_CHANGE,
              data: {
                status: task.status,
                result: task.result,
                error: task.error,
              },
              taskId,
              timestamp: new Date().toISOString(),
            },
          } as MessageEvent);
          responseSubject.complete();
          return responseSubject.asObservable();
        }

        // For active tasks, subscribe to live updates
        this.logger.debug(`Task ${taskId} is active, subscribing to updates`);
        const subject = this.sseService.getTaskSubject(taskId);
        this.sseService.addSubscriber(taskId);

        // Forward all future updates
        const subscription = subject.subscribe({
          next: (event) => responseSubject.next(event),
          error: (err) => responseSubject.error(err),
          complete: () => responseSubject.complete(),
        });

        return responseSubject.pipe(
          finalize(() => {
            subscription.unsubscribe();
            this.sseService.removeSubscriber(taskId);
            this.logger.debug(`SSE connection closed for task ${taskId}`);
          }),
        );
      }),
    );
  }

  /**
   * API 6: Process timeout detection
   * POST /api/v1/tasks/timeouts/process
   */
  @Post('timeouts/process')
  async processTimeouts(): Promise<{ processedCount: number }> {
    return this.taskService.processTimeouts();
  }

  /**
   * API 7: Claim a task
   * POST /api/v1/tasks/claim
   */
  @Post('claim')
  async claimTask(@Body() dto: ClaimTaskDto): Promise<Task | null> {
    return this.taskService.claimTask(dto);
  }

  /**
   * API 8: Release a task
   * POST /api/v1/tasks/:taskId/release
   */
  @Post(':taskId/release')
  async releaseTask(
    @Param('taskId') taskId: string,
    @Body() dto: ReleaseTaskDto,
  ): Promise<ReleaseTaskResponse> {
    return this.taskService.releaseTask(taskId, dto.workerId);
  }

  /**
   * API 9: Retry a task
   * POST /api/v1/tasks/:taskId/retry
   */
  @Post(':taskId/retry')
  async retryTask(@Param('taskId') taskId: string): Promise<RetryTaskResponse> {
    return this.taskService.retryTask(taskId);
  }
}
