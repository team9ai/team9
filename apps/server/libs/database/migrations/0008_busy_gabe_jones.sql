CREATE TABLE IF NOT EXISTS "im_email_verification_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token" varchar(64) NOT NULL,
	"email" varchar(255) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_email_verification_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'im_users' AND column_name = 'email_verified') THEN
    ALTER TABLE "im_users" ADD COLUMN "email_verified" boolean DEFAULT false NOT NULL;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'im_users' AND column_name = 'email_verified_at') THEN
    ALTER TABLE "im_users" ADD COLUMN "email_verified_at" timestamp;
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "im_email_verification_tokens" ADD CONSTRAINT "im_email_verification_tokens_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_verification_tokens_user_id" ON "im_email_verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_verification_tokens_token" ON "im_email_verification_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "idx_verification_tokens_expires_at" ON "im_email_verification_tokens" USING btree ("expires_at");