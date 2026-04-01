import {
  Controller,
  Get,
  Param,
  Query,
  Req,
  Res,
  Logger,
  NotFoundException,
  Inject,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { JwtService } from '@nestjs/jwt';
import type { JwtPayload } from '@team9/auth';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { env } from '@team9/shared';

@Controller({ path: 'tasks', version: '1' })
export class TasksStreamController {
  private readonly logger = new Logger(TasksStreamController.name);
  private readonly taskcastUrl: string;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly jwtService: JwtService,
    configService: ConfigService,
  ) {
    this.taskcastUrl = configService.get<string>(
      'TASKCAST_URL',
      'http://localhost:3721',
    );
  }

  @Get(':taskId/executions/:execId/stream')
  async streamExecution(
    @Param('taskId', ParseUUIDPipe) taskId: string,
    @Param('execId', ParseUUIDPipe) execId: string,
    @Query('token') queryToken: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    // ── Auth: accept Bearer header or ?token= query param ──
    const headerToken = req.headers.authorization?.replace('Bearer ', '');
    const token = headerToken || queryToken;

    if (!token) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let userId: string;
    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        publicKey: env.JWT_PUBLIC_KEY,
        algorithms: ['ES256'],
      });
      userId = payload.sub;
    } catch {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // ── Deterministic TaskCast ID — no DB lookup for taskcastTaskId ──
    const taskcastTaskId = `agent_task_exec_${execId}`;

    // ── Verify execution exists and belongs to this task ──
    const [execution] = await this.db
      .select({ id: schema.agentTaskExecutions.id })
      .from(schema.agentTaskExecutions)
      .where(
        and(
          eq(schema.agentTaskExecutions.id, execId),
          eq(schema.agentTaskExecutions.taskId, taskId),
        ),
      )
      .limit(1);

    if (!execution) {
      throw new NotFoundException('Execution not found');
    }

    // ── Verify user belongs to the task's workspace ──
    const [task] = await this.db
      .select({ tenantId: schema.agentTasks.tenantId })
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (task) {
      const [membership] = await this.db
        .select({ id: schema.tenantMembers.id })
        .from(schema.tenantMembers)
        .where(
          and(
            eq(schema.tenantMembers.tenantId, task.tenantId),
            eq(schema.tenantMembers.userId, userId),
          ),
        )
        .limit(1);

      if (!membership) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }

    // ── Proxy SSE from TaskCast ──
    const upstream = `${this.taskcastUrl}/tasks/${taskcastTaskId}/events/stream`;
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    };

    const lastEventId = req.headers['last-event-id'] as string | undefined;
    if (lastEventId) {
      headers['Last-Event-ID'] = lastEventId;
    }

    const controller = new AbortController();

    // Clean up upstream when client disconnects
    req.on('close', () => controller.abort());

    try {
      const upstreamRes = await fetch(upstream, {
        headers,
        signal: controller.signal,
      });

      if (!upstreamRes.ok || !upstreamRes.body) {
        res.status(502).json({ error: 'TaskCast upstream unavailable' });
        return;
      }

      // Set SSE headers
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Pipe upstream → client
      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();

      const pump = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
          }
        } catch {
          // Client disconnected or abort — expected
        } finally {
          res.end();
        }
      };

      void pump();
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      this.logger.error(`SSE proxy error: ${error}`);
      if (!res.headersSent) {
        res.status(502).json({ error: 'TaskCast upstream unavailable' });
      }
    }
  }
}
