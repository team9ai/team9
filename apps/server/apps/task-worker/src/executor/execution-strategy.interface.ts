export interface ExecutionContext {
  routineId: string;
  executionId: string;
  botId: string;
  channelId: string;
  title: string;
  documentContent?: string;
  taskcastTaskId: string | null;
  tenantId: string; // required for session ID construction
  message?: string; // carries resume message; undefined for start/stop/pause
}

export interface ExecutionStrategy {
  execute(context: ExecutionContext): Promise<void>;
  pause(context: ExecutionContext): Promise<void>;
  resume(context: ExecutionContext): Promise<void>;
  stop(context: ExecutionContext): Promise<void>;
}
