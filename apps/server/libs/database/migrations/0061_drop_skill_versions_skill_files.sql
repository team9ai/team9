DROP TABLE "skill_files";
--> statement-breakpoint
DROP TABLE "skill_versions";
--> statement-breakpoint
ALTER TABLE "skills" DROP COLUMN "current_version";
--> statement-breakpoint
DROP TYPE "public"."skill_version__status";
