-- Align workspace_wikis.workspace_id with the rest of the schema: uuid
-- column with ON DELETE CASCADE FK to tenants.id (see im/channels, im/
-- notifications, im/channel-sections). Every existing row's workspace_id
-- was sourced from tenants.id (which is already uuid), so the `::uuid`
-- cast is total and cannot fail for extant data.
ALTER TABLE "workspace_wikis"
  ALTER COLUMN "workspace_id" TYPE uuid USING "workspace_id"::uuid;--> statement-breakpoint
ALTER TABLE "workspace_wikis"
  ADD CONSTRAINT "workspace_wikis_workspace_id_tenants_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
