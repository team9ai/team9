CREATE TYPE "public"."skill__agent_access" AS ENUM('none', 'read', 'write');
--> statement-breakpoint
ALTER TABLE "skills" ADD COLUMN "agent_access" "skill__agent_access" DEFAULT 'read' NOT NULL;
