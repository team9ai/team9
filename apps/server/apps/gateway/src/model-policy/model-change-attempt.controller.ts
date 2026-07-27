import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser } from '@team9/auth';
import {
  DATABASE_CONNECTION,
  and,
  eq,
  isNull,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';

type PublicModelChangeState = 'pending' | 'dispatched' | 'failed' | 'rejected';

interface ModelChangeAttemptResponse {
  attemptId: string;
  state: PublicModelChangeState;
  reasonCode?: string;
  safeErrorCode?: string;
  createdAt: string;
  updatedAt: string;
  dispatchedAt: string | null;
}

@Controller({ path: 'model-changes', version: '1' })
@UseGuards(AuthGuard)
export class ModelChangeAttemptController {
  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  @Get(':attemptId')
  async getAttempt(
    @CurrentUser('sub') userId: string,
    @Param('attemptId', ParseUUIDPipe) attemptId: string,
  ): Promise<ModelChangeAttemptResponse> {
    const [attempt] = await this.db
      .select()
      .from(schema.modelChangeAttempts)
      .where(eq(schema.modelChangeAttempts.id, attemptId))
      .limit(1);
    if (!attempt || !(await this.canViewAttempt(attempt, userId))) {
      throw new NotFoundException('Model change attempt not found');
    }

    const state = this.publicState(attempt);
    return {
      attemptId: attempt.id,
      state,
      ...(state === 'rejected' || state === 'failed'
        ? { reasonCode: attempt.reasonCode }
        : {}),
      ...(state === 'failed' && attempt.safeErrorCode
        ? { safeErrorCode: attempt.safeErrorCode }
        : {}),
      createdAt: attempt.createdAt.toISOString(),
      updatedAt: attempt.updatedAt.toISOString(),
      dispatchedAt: attempt.dispatchedAt?.toISOString() ?? null,
    };
  }

  private async canViewAttempt(
    attempt: typeof schema.modelChangeAttempts.$inferSelect,
    userId: string,
  ): Promise<boolean> {
    if (attempt.actorUserId === userId) return true;
    if (!attempt.tenantId) return false;

    const [membership] = await this.db
      .select({ id: schema.tenantMembers.id })
      .from(schema.tenantMembers)
      .where(
        and(
          eq(schema.tenantMembers.tenantId, attempt.tenantId),
          eq(schema.tenantMembers.userId, userId),
          isNull(schema.tenantMembers.leftAt),
        ),
      )
      .limit(1);
    return Boolean(membership);
  }

  private publicState(
    attempt: typeof schema.modelChangeAttempts.$inferSelect,
  ): PublicModelChangeState {
    if (attempt.decision === 'rejected') return 'rejected';
    if (attempt.dispatchStatus === 'dispatched') return 'dispatched';
    if (attempt.dispatchStatus === 'failed') return 'failed';
    return 'pending';
  }
}
