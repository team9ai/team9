import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import * as crypto from 'crypto';
import {
  DATABASE_CONNECTION,
  and,
  desc,
  eq,
  lte,
  or,
  type PostgresJsDatabase,
} from '@team9/database';
import * as schema from '@team9/database/schemas';
import { EmailService } from '@team9/email';
import { env } from '@team9/shared';
import type { CreateEmailChangeDto } from './dto/index.js';

export interface PendingEmailChange {
  id: string;
  currentEmail: string;
  newEmail: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface PendingEmailChangeResponse {
  pendingEmailChange: PendingEmailChange | null;
}

export interface EmailChangeMutationResponse extends PendingEmailChangeResponse {
  message: string;
  confirmationLink?: string;
}

type EmailChangeConfirmationEmailSender = {
  sendEmailChangeConfirmationEmail(
    email: string,
    username: string,
    currentEmail: string,
    confirmationLink: string,
  ): Promise<boolean>;
};

@Injectable()
export class AccountService {
  private readonly EMAIL_CHANGE_TOKEN_EXPIRY_HOURS = 24;

  constructor(
    @Inject(DATABASE_CONNECTION)
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly emailService: EmailService,
  ) {}

  async getPendingEmailChange(
    userId: string,
  ): Promise<PendingEmailChangeResponse> {
    const request = await this.findPendingRequest(userId);

    return {
      pendingEmailChange: request ? this.serializeRequest(request) : null,
    };
  }

  async createEmailChange(
    userId: string,
    dto: CreateEmailChangeDto,
  ): Promise<EmailChangeMutationResponse> {
    const user = await this.getUserOrThrow(userId);

    if (user.email === dto.newEmail) {
      throw new BadRequestException(
        'New email must be different from the current email',
      );
    }

    await this.assertEmailAvailable(dto.newEmail, {
      excludeUserId: userId,
    });

    const { tokenHash, expiresAt, confirmationLink } =
      this.generateConfirmationArtifacts();
    const now = new Date();

    let request: schema.UserEmailChangeRequest;

    try {
      request = await this.db.transaction(async (tx) => {
        await this.expireExpiredPendingRequests(tx, {
          userId,
          newEmail: dto.newEmail,
          now,
        });

        await tx
          .update(schema.userEmailChangeRequests)
          .set({
            status: 'cancelled',
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.userEmailChangeRequests.userId, userId),
              eq(schema.userEmailChangeRequests.status, 'pending'),
            ),
          );

        const [insertedRequest] = await tx
          .insert(schema.userEmailChangeRequests)
          .values({
            id: uuidv7(),
            userId: user.id,
            currentEmail: user.email,
            newEmail: dto.newEmail,
            tokenHash,
            status: 'pending',
            expiresAt,
          })
          .returning();

        return insertedRequest;
      });
    } catch (error) {
      throw this.mapEmailChangeWriteError(error);
    }

    await this.sendConfirmationEmail(
      dto.newEmail,
      user.username,
      user.email,
      confirmationLink,
    );

    return {
      message: 'Confirmation email sent.',
      pendingEmailChange: this.serializeRequest(request),
      ...(env.DEV_SKIP_EMAIL_VERIFICATION && { confirmationLink }),
    };
  }

  async resendEmailChange(
    userId: string,
  ): Promise<EmailChangeMutationResponse> {
    const request = await this.getPendingRequestOrThrow(userId);
    const user = await this.getUserOrThrow(userId);

    await this.assertEmailAvailable(request.newEmail, {
      excludeUserId: userId,
      excludeRequestId: request.id,
    });

    const { tokenHash, expiresAt, confirmationLink } =
      this.generateConfirmationArtifacts();
    const now = new Date();

    let updatedRequest: schema.UserEmailChangeRequest;
    try {
      [updatedRequest] = await this.db
        .update(schema.userEmailChangeRequests)
        .set({
          tokenHash,
          status: 'pending',
          expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.userEmailChangeRequests.id, request.id),
            eq(schema.userEmailChangeRequests.status, 'pending'),
          ),
        )
        .returning();
    } catch (error) {
      throw this.mapEmailChangeWriteError(error);
    }

    if (!updatedRequest) {
      throw new BadRequestException('Email change request is no longer active');
    }

    await this.sendConfirmationEmail(
      updatedRequest.newEmail,
      user.username,
      updatedRequest.currentEmail,
      confirmationLink,
    );

    return {
      message: 'Confirmation email resent.',
      pendingEmailChange: this.serializeRequest(updatedRequest),
      ...(env.DEV_SKIP_EMAIL_VERIFICATION && { confirmationLink }),
    };
  }

  async cancelEmailChange(userId: string): Promise<{ message: string }> {
    await this.expireExpiredPendingRequests(this.db, {
      userId,
      now: new Date(),
    });

    const cancelledRequests = await this.db
      .update(schema.userEmailChangeRequests)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.userEmailChangeRequests.userId, userId),
          eq(schema.userEmailChangeRequests.status, 'pending'),
        ),
      )
      .returning();

    if (cancelledRequests.length === 0) {
      throw new NotFoundException('No pending email change request found');
    }

    return { message: 'Pending email change cancelled.' };
  }

  async confirmEmailChange(token: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);

    const request = await this.getRequestByTokenHash(tokenHash);

    if (!request) {
      throw new BadRequestException('Invalid email change token');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('Email change request is no longer active');
    }

    const now = new Date();

    try {
      await this.db.transaction(async (tx) => {
        if (request.expiresAt.getTime() <= now.getTime()) {
          const [expiredRequest] = await tx
            .update(schema.userEmailChangeRequests)
            .set({
              status: 'expired',
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.userEmailChangeRequests.id, request.id),
                eq(schema.userEmailChangeRequests.tokenHash, tokenHash),
                eq(schema.userEmailChangeRequests.status, 'pending'),
              ),
            )
            .returning();

          if (!expiredRequest) {
            throw new BadRequestException(
              'Email change request is no longer active',
            );
          }

          throw new BadRequestException('Email change token has expired');
        }

        const user = await this.getUserOrThrow(request.userId, tx);
        await this.assertEmailAvailable(
          request.newEmail,
          {
            excludeUserId: request.userId,
            excludeRequestId: request.id,
          },
          tx,
        );

        const [confirmedRequest] = await tx
          .update(schema.userEmailChangeRequests)
          .set({
            status: 'confirmed',
            confirmedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.userEmailChangeRequests.id, request.id),
              eq(schema.userEmailChangeRequests.tokenHash, tokenHash),
              eq(schema.userEmailChangeRequests.status, 'pending'),
            ),
          )
          .returning();

        if (!confirmedRequest) {
          throw new BadRequestException(
            'Email change request is no longer active',
          );
        }

        await tx
          .update(schema.users)
          .set({
            email: confirmedRequest.newEmail,
            emailVerified: true,
            emailVerifiedAt: now,
            updatedAt: now,
          })
          .where(eq(schema.users.id, user.id))
          .returning();
      });
    } catch (error) {
      throw this.mapEmailChangeWriteError(error);
    }

    return { message: 'Email address updated successfully.' };
  }

  private async getUserOrThrow(
    userId: string,
    executor?: Pick<PostgresJsDatabase<typeof schema>, 'select'>,
  ) {
    const db = executor ?? this.db;
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.userType !== 'human') {
      throw new UnauthorizedException('This account cannot change email');
    }

    return user;
  }

  private async assertEmailAvailable(
    newEmail: string,
    options: {
      excludeUserId?: string;
      excludeRequestId?: string;
    } = {},
    executor?: Pick<PostgresJsDatabase<typeof schema>, 'select' | 'update'>,
  ) {
    const db = executor ?? this.db;
    const [existingUser] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, newEmail))
      .limit(1);

    if (existingUser && existingUser.id !== options.excludeUserId) {
      throw new ConflictException('Email already in use');
    }

    const pendingReservation = await this.findPendingReservationByEmail(
      newEmail,
      options,
      executor,
    );

    if (pendingReservation) {
      throw new ConflictException('Email already in use');
    }
  }

  private async getPendingRequestOrThrow(userId: string) {
    const request = await this.findPendingRequest(userId);

    if (!request) {
      throw new NotFoundException('No pending email change request found');
    }

    return request;
  }

  private async findPendingRequest(userId: string) {
    await this.expireExpiredPendingRequests(this.db, {
      userId,
      now: new Date(),
    });

    const [request] = await this.db
      .select()
      .from(schema.userEmailChangeRequests)
      .where(
        and(
          eq(schema.userEmailChangeRequests.userId, userId),
          eq(schema.userEmailChangeRequests.status, 'pending'),
        ),
      )
      .orderBy(
        desc(schema.userEmailChangeRequests.updatedAt),
        desc(schema.userEmailChangeRequests.createdAt),
        desc(schema.userEmailChangeRequests.id),
      )
      .limit(1);

    return request;
  }

  private async findPendingReservationByEmail(
    newEmail: string,
    options: {
      excludeUserId?: string;
      excludeRequestId?: string;
    },
    executor?: Pick<PostgresJsDatabase<typeof schema>, 'select' | 'update'>,
  ) {
    const db = executor ?? this.db;
    await this.expireExpiredPendingRequests(db, {
      newEmail,
      now: new Date(),
    });

    const pendingRequests = await db
      .select()
      .from(schema.userEmailChangeRequests)
      .where(
        and(
          eq(schema.userEmailChangeRequests.newEmail, newEmail),
          eq(schema.userEmailChangeRequests.status, 'pending'),
        ),
      )
      .orderBy(
        desc(schema.userEmailChangeRequests.updatedAt),
        desc(schema.userEmailChangeRequests.createdAt),
        desc(schema.userEmailChangeRequests.id),
      )
      .limit(10);

    return (
      pendingRequests.find((request) => {
        if (
          options.excludeRequestId &&
          request.id === options.excludeRequestId
        ) {
          return false;
        }

        if (options.excludeUserId && request.userId === options.excludeUserId) {
          return false;
        }

        return true;
      }) ?? null
    );
  }

  private async getRequestByTokenHash(tokenHash: string) {
    const [request] = await this.db
      .select()
      .from(schema.userEmailChangeRequests)
      .where(eq(schema.userEmailChangeRequests.tokenHash, tokenHash))
      .limit(1);

    return request ?? null;
  }

  private serializeRequest(
    request: schema.UserEmailChangeRequest,
  ): PendingEmailChange {
    return {
      id: request.id,
      currentEmail: request.currentEmail,
      newEmail: request.newEmail,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
    };
  }

  private generateConfirmationArtifacts() {
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(token);
    const expiresAt = new Date(
      Date.now() + this.EMAIL_CHANGE_TOKEN_EXPIRY_HOURS * 60 * 60 * 1000,
    );
    const confirmationLink = `${env.APP_URL}/confirm-email-change?token=${token}`;

    return { tokenHash, expiresAt, confirmationLink };
  }

  private async expireExpiredPendingRequests(
    executor: Pick<PostgresJsDatabase<typeof schema>, 'update'>,
    options: {
      userId?: string;
      newEmail?: string;
      now: Date;
    },
  ) {
    const scopeCondition =
      options.userId && options.newEmail
        ? or(
            eq(schema.userEmailChangeRequests.userId, options.userId),
            eq(schema.userEmailChangeRequests.newEmail, options.newEmail),
          )
        : options.userId
          ? eq(schema.userEmailChangeRequests.userId, options.userId)
          : options.newEmail
            ? eq(schema.userEmailChangeRequests.newEmail, options.newEmail)
            : undefined;

    const conditions = [
      eq(schema.userEmailChangeRequests.status, 'pending'),
      lte(schema.userEmailChangeRequests.expiresAt, options.now),
      scopeCondition,
    ].filter(Boolean);

    await executor
      .update(schema.userEmailChangeRequests)
      .set({
        status: 'expired',
        updatedAt: options.now,
      })
      .where(and(...conditions));
  }

  private async sendConfirmationEmail(
    newEmail: string,
    username: string,
    currentEmail: string,
    confirmationLink: string,
  ): Promise<void> {
    if (env.DEV_SKIP_EMAIL_VERIFICATION) {
      return;
    }

    const emailService = this
      .emailService as unknown as EmailChangeConfirmationEmailSender;

    await emailService.sendEmailChangeConfirmationEmail(
      newEmail,
      username,
      currentEmail,
      confirmationLink,
    );
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private mapEmailChangeWriteError(error: unknown): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof NotFoundException ||
      error instanceof UnauthorizedException
    ) {
      return error;
    }

    if ((error as { code?: string })?.code === '23505') {
      return new ConflictException('Email already in use');
    }

    return error as Error;
  }
}
