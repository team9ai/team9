import { Injectable, Logger } from '@nestjs/common';
import type {
  ExecutionStrategy,
  ExecutionContext,
} from '../execution-strategy.interface.js';

@Injectable()
export class OpenclawStrategy implements ExecutionStrategy {
  private readonly logger = new Logger(OpenclawStrategy.name);

  async execute(context: ExecutionContext): Promise<void> {
    this.logger.log(`Starting OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/execute
  }

  async pause(context: ExecutionContext): Promise<void> {
    this.logger.log(`Pausing OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/pause
  }

  async resume(context: ExecutionContext): Promise<void> {
    this.logger.log(`Resuming OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/resume
  }

  async stop(context: ExecutionContext): Promise<void> {
    this.logger.log(`Stopping OpenClaw agent for task ${context.taskId}`);
    // TODO: POST {openclaw_url}/api/agents/{agentId}/stop
  }
}
