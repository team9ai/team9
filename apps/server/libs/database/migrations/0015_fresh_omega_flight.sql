ALTER TABLE "im_bots" ADD COLUMN "mentor_id" uuid;--> statement-breakpoint
ALTER TABLE "im_bots" ADD CONSTRAINT "im_bots_mentor_id_im_users_id_fk" FOREIGN KEY ("mentor_id") REFERENCES "public"."im_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_bots_mentor_id" ON "im_bots" USING btree ("mentor_id");--> statement-breakpoint
CREATE INDEX "idx_bots_access_token" ON "im_bots" USING btree ("access_token");