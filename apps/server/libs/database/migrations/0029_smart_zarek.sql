CREATE TYPE "public"."user_email_change_request_status" AS ENUM('pending', 'confirmed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TABLE "im_user_email_change_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"current_email" varchar(255) NOT NULL,
	"new_email" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" "user_email_change_request_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"confirmed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_user_email_change_requests_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "im_user_email_change_requests" ADD CONSTRAINT "im_user_email_change_requests_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_email_change_requests_user_id" ON "im_user_email_change_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_email_change_requests_status" ON "im_user_email_change_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_user_email_change_requests_expires_at" ON "im_user_email_change_requests" USING btree ("expires_at");