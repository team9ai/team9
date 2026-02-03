import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';
import { env } from '@team9/shared';
import { emailVerificationTemplate } from './templates/email-verification.template.js';
import { passwordResetTemplate } from './templates/password-reset.template.js';
import { magicLoginTemplate } from './templates/magic-login.template.js';

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly fromEmail: string;

  constructor() {
    const apiKey = env.RESEND_API_KEY;
    if (apiKey) {
      this.resend = new Resend(apiKey);
      this.logger.log(
        `Email service initialized with Resend, API key prefix: ${apiKey.substring(0, 8)}..., from: ${env.EMAIL_FROM}`,
      );
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not configured - email features will be disabled',
      );
    }
    this.fromEmail = env.EMAIL_FROM;
  }

  isEnabled(): boolean {
    return this.resend !== null;
  }

  async sendVerificationEmail(
    email: string,
    username: string,
    verificationLink: string,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.warn(
        'Email service not configured, skipping verification email',
      );
      return false;
    }

    const { html, text } = emailVerificationTemplate({
      username,
      verificationLink,
    });

    return this.send({
      to: email,
      subject: 'Verify your Team9 email address',
      html,
      text,
    });
  }

  async sendLoginEmail(
    email: string,
    username: string,
    loginLink: string,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.warn('Email service not configured, skipping login email');
      return false;
    }

    const { html, text } = magicLoginTemplate({
      username,
      loginLink,
    });

    return this.send({
      to: email,
      subject: 'Sign in to Team9',
      html,
      text,
    });
  }

  async sendPasswordResetEmail(
    email: string,
    username: string,
    resetLink: string,
  ): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.warn(
        'Email service not configured, skipping password reset email',
      );
      return false;
    }

    const { html, text } = passwordResetTemplate({
      username,
      resetLink,
    });

    return this.send({
      to: email,
      subject: 'Reset your Team9 password',
      html,
      text,
    });
  }

  private async send(options: SendEmailOptions): Promise<boolean> {
    if (!this.resend) {
      this.logger.warn('Resend client is null, cannot send email');
      return false;
    }

    const sendPayload = {
      from: this.fromEmail,
      to: options.to,
      subject: options.subject,
    };
    this.logger.log(`Attempting to send email: ${JSON.stringify(sendPayload)}`);

    try {
      const { data, error } = await this.resend.emails.send({
        from: this.fromEmail,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      if (error) {
        this.logger.error(
          `Failed to send email to ${options.to}, Resend error: ${JSON.stringify(error)}`,
        );
        return false;
      }

      this.logger.log(
        `Email sent successfully to ${options.to}, id: ${data?.id}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Error sending email to ${options.to}, exception: ${error instanceof Error ? error.message : JSON.stringify(error)}, stack: ${error instanceof Error ? error.stack : 'N/A'}`,
      );
      return false;
    }
  }
}
