ALTER TABLE "im_bots" ADD COLUMN IF NOT EXISTS "mentor_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'im_bots_mentor_id_im_users_id_fk') THEN
    ALTER TABLE "im_bots" ADD CONSTRAINT "im_bots_mentor_id_im_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bots_mentor_id" ON "im_bots" USING btree ("mentor_id");