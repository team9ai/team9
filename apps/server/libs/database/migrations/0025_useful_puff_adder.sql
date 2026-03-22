ALTER TABLE "im_bots" ADD COLUMN "managed_provider" text;--> statement-breakpoint
ALTER TABLE "im_bots" ADD COLUMN "managed_meta" jsonb;--> statement-breakpoint
CREATE INDEX "idx_bots_managed_provider" ON "im_bots" USING btree ("managed_provider");--> statement-breakpoint
-- Migrate existing openclaw bots to use managedProvider/managedMeta
UPDATE "im_bots"
SET "managed_provider" = 'openclaw',
    "managed_meta" = "extra"->'openclaw'
WHERE "extra"->>'openclaw' IS NOT NULL
  AND "managed_provider" IS NULL;