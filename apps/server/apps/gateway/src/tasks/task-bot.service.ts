import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import {
  DATABASE_CONNECTION,
  eq,
  and,
  desc,
  sql,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import type { ReportStepsDto } from './dto/report-steps.dto.js';
import type { CreateInterventionDto } from './dto/create-intervention.dto.js';

// ── Service ─────────────────────────────────────────────────────────

@Injectable()
export class TaskBotService {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  // ── Report step progress ─────────────────────────────────────────

  async reportSteps(taskId: string, botUserId: string, dto: ReportStepsDto) {
    const { execution } = await this.getActiveExecution(taskId);

    for (const step of dto.steps) {
      // Check if a step already exists for this execution + orderIndex
      const [existing] = await this.db
        .select()
        .from(schema.agentTaskSteps)
        .where(
          and(
            eq(schema.agentTaskSteps.executionId, execution.id),
            eq(schema.agentTaskSteps.orderIndex, step.orderIndex),
          ),
        )
        .limit(1);

      if (existing) {
        // Update existing step
        const updateData: Record<string, unknown> = {
          title: step.title,
          status: step.status,
        };

        if (step.tokenUsage !== undefined) {
          updateData.tokenUsage = step.tokenUsage;
        }
        if (step.duration !== undefined) {
          updateData.duration = step.duration;
        }

        if (step.status === 'in_progress' && !existing.startedAt) {
          updateData.startedAt = new Date();
        }
        if (step.status === 'completed' || step.status === 'failed') {
          updateData.completedAt = new Date();
        }

        await this.db
          .update(schema.agentTaskSteps)
          .set(updateData)
          .where(eq(schema.agentTaskSteps.id, existing.id));
      } else {
        // Create new step
        const now = new Date();
        await this.db.insert(schema.agentTaskSteps).values({
          id: uuidv7(),
          executionId: execution.id,
          taskId,
          orderIndex: step.orderIndex,
          title: step.title,
          status: step.status,
          tokenUsage: step.tokenUsage ?? 0,
          duration: step.duration ?? null,
          startedAt: step.status === 'in_progress' ? now : null,
          completedAt:
            step.status === 'completed' || step.status === 'failed'
              ? now
              : null,
        });
      }
    }

    // Sum all step token usage and update execution total
    const [result] = await this.db
      .select({
        total: sql<number>`COALESCE(SUM(${schema.agentTaskSteps.tokenUsage}), 0)`,
      })
      .from(schema.agentTaskSteps)
      .where(eq(schema.agentTaskSteps.executionId, execution.id));

    await this.db
      .update(schema.agentTaskExecutions)
      .set({ tokenUsage: result.total })
      .where(eq(schema.agentTaskExecutions.id, execution.id));

    // Return updated steps
    const steps = await this.db
      .select()
      .from(schema.agentTaskSteps)
      .where(eq(schema.agentTaskSteps.executionId, execution.id))
      .orderBy(schema.agentTaskSteps.orderIndex);

    return steps;
  }

  // ── Update execution status ──────────────────────────────────────

  async updateStatus(
    taskId: string,
    botUserId: string,
    status: string,
    error?: { code?: string; message: string },
  ) {
    const { task, execution } = await this.getActiveExecution(taskId);

    const validTerminalStatuses = ['completed', 'failed', 'timeout'];
    if (!validTerminalStatuses.includes(status)) {
      throw new BadRequestException(
        `Invalid status '${status}'. Must be one of: ${validTerminalStatuses.join(', ')}`,
      );
    }

    const now = new Date();

    // Update execution
    const executionUpdate: Record<string, unknown> = {
      status,
      completedAt: now,
    };

    if (execution.startedAt) {
      executionUpdate.duration = Math.round(
        (now.getTime() - execution.startedAt.getTime()) / 1000,
      );
    }

    if (error) {
      executionUpdate.error = error;
    }

    const [updatedExecution] = await this.db
      .update(schema.agentTaskExecutions)
      .set(executionUpdate)
      .where(eq(schema.agentTaskExecutions.id, execution.id))
      .returning();

    // Update task status
    const [updatedTask] = await this.db
      .update(schema.agentTasks)
      .set({
        status: status as schema.AgentTaskStatus,
        updatedAt: now,
      })
      .where(eq(schema.agentTasks.id, taskId))
      .returning();

    return { task: updatedTask, execution: updatedExecution };
  }

  // ── Create intervention ──────────────────────────────────────────

  async createIntervention(
    taskId: string,
    botUserId: string,
    dto: CreateInterventionDto,
  ) {
    const { task, execution } = await this.getActiveExecution(taskId);

    const interventionId = uuidv7();

    const [intervention] = await this.db
      .insert(schema.agentTaskInterventions)
      .values({
        id: interventionId,
        executionId: execution.id,
        taskId,
        stepId: dto.stepId ?? null,
        prompt: dto.prompt,
        actions: dto.actions,
      })
      .returning();

    // Set task status to pending_action
    await this.db
      .update(schema.agentTasks)
      .set({
        status: 'pending_action',
        updatedAt: new Date(),
      })
      .where(eq(schema.agentTasks.id, taskId));

    return intervention;
  }

  // ── Add deliverable ──────────────────────────────────────────────

  async addDeliverable(
    taskId: string,
    botUserId: string,
    data: {
      fileName: string;
      fileSize?: number;
      mimeType?: string;
      fileUrl: string;
    },
  ) {
    const { execution } = await this.getActiveExecution(taskId);

    const deliverableId = uuidv7();

    const [deliverable] = await this.db
      .insert(schema.agentTaskDeliverables)
      .values({
        id: deliverableId,
        executionId: execution.id,
        taskId,
        fileName: data.fileName,
        fileSize: data.fileSize ?? null,
        mimeType: data.mimeType ?? null,
        fileUrl: data.fileUrl,
      })
      .returning();

    return deliverable;
  }

  // ── Get task document ────────────────────────────────────────────

  async getTaskDocument(taskId: string) {
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (!task.documentId) {
      return null;
    }

    const [document] = await this.db
      .select()
      .from(schema.documents)
      .where(eq(schema.documents.id, task.documentId))
      .limit(1);

    if (!document) {
      throw new NotFoundException('Document not found');
    }

    let currentVersion: {
      id: string;
      versionIndex: number;
      content: string;
      summary: string | null;
      createdAt: Date;
    } | null = null;

    if (document.currentVersionId) {
      const [ver] = await this.db
        .select()
        .from(schema.documentVersions)
        .where(eq(schema.documentVersions.id, document.currentVersionId))
        .limit(1);

      if (ver) {
        currentVersion = {
          id: ver.id,
          versionIndex: ver.versionIndex,
          content: ver.content,
          summary: ver.summary,
          createdAt: ver.createdAt,
        };
      }
    }

    return {
      id: document.id,
      title: document.title,
      documentType: document.documentType,
      currentVersion,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async getActiveExecution(taskId: string) {
    const [task] = await this.db
      .select()
      .from(schema.agentTasks)
      .where(eq(schema.agentTasks.id, taskId))
      .limit(1);

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (!task.currentExecutionId) {
      throw new NotFoundException('Task has no active execution');
    }

    const [execution] = await this.db
      .select()
      .from(schema.agentTaskExecutions)
      .where(eq(schema.agentTaskExecutions.id, task.currentExecutionId))
      .limit(1);

    if (!execution) {
      throw new NotFoundException('Active execution not found');
    }

    return { task, execution };
  }
}
