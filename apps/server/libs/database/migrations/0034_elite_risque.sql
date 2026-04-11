ALTER TYPE "public"."routine__status" ADD VALUE 'draft' BEFORE 'upcoming';--> statement-breakpoint
ALTER TABLE "routine__routines" ADD COLUMN "creation_channel_id" uuid;--> statement-breakpoint
ALTER TABLE "routine__routines" ADD COLUMN "creation_session_id" varchar(255);--> statement-breakpoint
ALTER TABLE "routine__routines" ADD COLUMN "source_ref" varchar(255);--> statement-breakpoint
ALTER TABLE "routine__routines" ADD CONSTRAINT "routine__routines_creation_channel_id_im_channels_id_fk" FOREIGN KEY ("creation_channel_id") REFERENCES "public"."im_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_routine__routines_creation_channel_id" ON "routine__routines" USING btree ("creation_channel_id");--> statement-breakpoint
CREATE INDEX "idx_routine__routines_source_ref" ON "routine__routines" USING btree ("source_ref");