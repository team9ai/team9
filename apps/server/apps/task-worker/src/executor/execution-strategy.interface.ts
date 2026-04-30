export interface ExecutionContext {
  routineId: string;
  executionId: string;
  botId: string;
  channelId: string;
  title: string;
  /**
   * folder9 folder ID hosting this routine's SKILL.md.
   *
   * Guaranteed non-null on the execute() path: the executor calls
   * `ensureRoutineFolder` before constructing the context, which lazily
   * provisions the folder if missing. On pause/resume/stop it's omitted —
   * those paths don't need folder access.
   */
  folderId?: string;
  /**
   * Read-scoped folder9 token bound to {@link folderId}, valid for the
   * expected execution duration (~6 hours). The agent runtime uses this to
   * read SKILL.md without needing the PSK or a per-request mint.
   *
   * Only present on the execute() path — pause/resume/stop don't need it.
   */
  folder9Token?: string;
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
