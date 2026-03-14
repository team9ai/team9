export interface ExecutionContext {
  taskId: string;
  executionId: string;
  botId: string;
  channelId: string;
  documentContent?: string;
  taskcastTaskId: string | null;
}

export interface ExecutionStrategy {
  execute(context: ExecutionContext): Promise<void>;
  pause(context: ExecutionContext): Promise<void>;
  resume(context: ExecutionContext): Promise<void>;
  stop(context: ExecutionContext): Promise<void>;
}
