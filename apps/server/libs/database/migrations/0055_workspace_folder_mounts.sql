-- workspace_folder_mounts: idempotent registry mapping
--   (workspace_id, scope, scope_id, mount_key) -> folder9_folder_id
-- Backs the JustBashTeam9WorkspaceComponent virtual workspace mount layer
-- (session.*, agent.*, user.*, routine.tmp, routine.home). Lazy-provisioned
-- by FolderMountResolver: SELECT first; on miss, create via Folder9 and
-- INSERT ... ON CONFLICT DO NOTHING. The unique index is the idempotency
-- guard (race-safe).
CREATE TABLE "workspace_folder_mounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" varchar(32) NOT NULL,
	"scope_id" varchar(128) NOT NULL,
	"mount_key" varchar(32) NOT NULL,
	"folder_type" varchar(16) NOT NULL,
	"folder9_folder_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_folder_mounts" ADD CONSTRAINT "workspace_folder_mounts_workspace_id_tenants_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_folder_mounts_unique" ON "workspace_folder_mounts" USING btree ("workspace_id","scope","scope_id","mount_key");
