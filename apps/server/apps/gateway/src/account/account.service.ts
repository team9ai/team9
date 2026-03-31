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
  eq,
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

    await this.assertEmailAvailable(dto.newEmail, userId);

    const existingRequest = await this.findPendingRequest(userId);
    if (existingRequest) {
      await this.db
        .update(schema.userEmailChangeRequests)
        .set({
          status: 'cancelled',
          updatedAt: new Date(),
        })
        .where(eq(schema.userEmailChangeRequests.id, existingRequest.id));
    }

    const { tokenHash, expiresAt, confirmationLink } =
      this.generateConfirmationArtifacts();

    const [request] = await this.db
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

    await this.assertEmailAvailable(request.newEmail, userId);

    const { tokenHash, expiresAt, confirmationLink } =
      this.generateConfirmationArtifacts();

    const [updatedRequest] = await this.db
      .update(schema.userEmailChangeRequests)
      .set({
        tokenHash,
        status: 'pending',
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(schema.userEmailChangeRequests.id, request.id))
      .returning();

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
    const request = await this.getPendingRequestOrThrow(userId);

    await this.db
      .update(schema.userEmailChangeRequests)
      .set({
        status: 'cancelled',
        updatedAt: new Date(),
      })
      .where(eq(schema.userEmailChangeRequests.id, request.id));

    return { message: 'Pending email change cancelled.' };
  }

  async confirmEmailChange(token: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(token);

    const [request] = await this.db
      .select()
      .from(schema.userEmailChangeRequests)
      .where(
        and(
          eq(schema.userEmailChangeRequests.tokenHash, tokenHash),
          eq(schema.userEmailChangeRequests.status, 'pending'),
        ),
      )
      .limit(1);

    if (!request) {
      throw new BadRequestException('Invalid email change token');
    }

    if (request.expiresAt.getTime() <= Date.now()) {
      await this.db
        .update(schema.userEmailChangeRequests)
        .set({
          status: 'expired',
          updatedAt: new Date(),
        })
        .where(eq(schema.userEmailChangeRequests.id, request.id));

      throw new BadRequestException('Email change token has expired');
    }

    const user = await this.getUserOrThrow(request.userId);
    await this.assertEmailAvailable(request.newEmail, request.userId);

    const now = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({
          email: request.newEmail,
          emailVerified: true,
          emailVerifiedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.users.id, user.id))
        .returning();

      await tx
        .update(schema.userEmailChangeRequests)
        .set({
          status: 'confirmed',
          confirmedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.userEmailChangeRequests.id, request.id));
    });

    return { message: 'Email address updated successfully.' };
  }

  private async getUserOrThrow(userId: string) {
    const [user] = await this.db
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

  private async assertEmailAvailable(newEmail: string, userId: string) {
    const [existingUser] = await this.db
      .select()
      .from(schema.users)
      .where(eq(schema.users.email, newEmail))
      .limit(1);

    if (existingUser && existingUser.id !== userId) {
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
    const [request] = await this.db
      .select()
      .from(schema.userEmailChangeRequests)
      .where(
        and(
          eq(schema.userEmailChangeRequests.userId, userId),
          eq(schema.userEmailChangeRequests.status, 'pending'),
        ),
      )
      .limit(1);

    if (!request) {
      return null;
    }

    if (request.expiresAt.getTime() <= Date.now()) {
      await this.db
        .update(schema.userEmailChangeRequests)
        .set({
          status: 'expired',
          updatedAt: new Date(),
        })
        .where(eq(schema.userEmailChangeRequests.id, request.id));

      return null;
    }

    return request;
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
    const confirmationLink = `${env.API_URL}/api/v1/account/confirm-email-change?token=${token}`;

    return { tokenHash, expiresAt, confirmationLink };
  }

  private async sendConfirmationEmail(
    newEmail: string,
    username: string,
    currentEmail: string,
    confirmationLink: string,
  ) {
    if (env.DEV_SKIP_EMAIL_VERIFICATION) {
      return;
    }

    await this.emailService.sendEmailChangeConfirmationEmail(
      newEmail,
      username,
      currentEmail,
      confirmationLink,
    );
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }
}
