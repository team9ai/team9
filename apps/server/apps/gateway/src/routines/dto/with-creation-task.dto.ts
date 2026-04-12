import { IsUUID } from 'class-validator';

export class CreateWithCreationTaskDto {
  /**
   * The `bots.id` (UUID) of the agent the user picked to guide routine creation.
   *
   * Named `agentId` in the API because from the user's perspective they are
   * selecting an "agent", not a database "bot". Internally this resolves to a
   * bots table row, and the claw-hive agent ID is derived from
   * `bot.managedMeta.agentId`.
   */
  @IsUUID()
  agentId: string;
}
