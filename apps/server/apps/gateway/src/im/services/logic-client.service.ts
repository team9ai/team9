import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CreateMessageDto, CreateMessageResponse } from '@team9/shared';

/**
 * Logic Client Service
 *
 * HTTP client for calling Logic Service from Gateway.
 * Provides synchronous message creation with the Outbox pattern.
 */
@Injectable()
export class LogicClientService implements OnModuleInit {
  private readonly logger = new Logger(LogicClientService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor() {
    this.baseUrl = process.env.LOGIC_SERVICE_URL || 'http://localhost:3001';
    this.timeout = parseInt(process.env.LOGIC_CLIENT_TIMEOUT || '5000', 10);
  }

  onModuleInit(): void {
    this.logger.log(`Logic client initialized, targeting: ${this.baseUrl}`);
  }

  /**
   * Create a message via Logic Service HTTP API
   *
   * This method:
   * 1. Sends message data to Logic Service
   * 2. Logic Service persists message + outbox event in transaction
   * 3. Returns msgId and seqId immediately
   * 4. Message delivery handled asynchronously by OutboxProcessor
   */
  async createMessage(dto: CreateMessageDto): Promise<CreateMessageResponse> {
    const url = `${this.baseUrl}/api/messages`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dto),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Logic service error (${response.status}): ${errorText}`,
        );
      }

      const result = (await response.json()) as CreateMessageResponse;

      this.logger.debug(
        `Message created via Logic: ${result.msgId} (${result.status})`,
      );

      return result;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Logic service timeout after ${this.timeout}ms`);
      }

      this.logger.error(`Failed to create message via Logic: ${error}`);
      throw error;
    }
  }

  /**
   * Health check for Logic Service
   */
  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return response.ok;
    } catch {
      return false;
    }
  }
}
