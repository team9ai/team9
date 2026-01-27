CREATE TABLE "im_channel_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"search_vector" "tsvector" NOT NULL,
	"name" varchar(255),
	"description" text,
	"channel_type" varchar(32),
	"member_count" integer DEFAULT 0 NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid,
	"channel_created_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_channel_search_channel_id_unique" UNIQUE("channel_id")
);
--> statement-breakpoint
CREATE TABLE "im_file_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"search_vector" "tsvector" NOT NULL,
	"file_name" varchar(500),
	"mime_type" varchar(255),
	"file_size" integer,
	"channel_id" uuid,
	"channel_name" varchar(255),
	"uploader_id" uuid,
	"uploader_username" varchar(100),
	"tenant_id" uuid,
	"file_created_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_file_search_file_id_unique" UNIQUE("file_id")
);
--> statement-breakpoint
CREATE TABLE "im_message_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"search_vector" "tsvector" NOT NULL,
	"content_snapshot" text,
	"channel_id" uuid NOT NULL,
	"channel_name" varchar(255),
	"sender_id" uuid,
	"sender_username" varchar(100),
	"sender_display_name" varchar(255),
	"message_type" varchar(32),
	"has_attachment" boolean DEFAULT false NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"is_thread_reply" boolean DEFAULT false NOT NULL,
	"tenant_id" uuid,
	"message_created_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_message_search_message_id_unique" UNIQUE("message_id")
);
--> statement-breakpoint
CREATE TABLE "im_user_search" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"search_vector" "tsvector" NOT NULL,
	"username" varchar(100),
	"display_name" varchar(255),
	"email" varchar(255),
	"status" varchar(32),
	"is_active" boolean DEFAULT true NOT NULL,
	"user_created_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "im_user_search_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "im_channel_search" ADD CONSTRAINT "im_channel_search_channel_id_im_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."im_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_file_search" ADD CONSTRAINT "im_file_search_file_id_im_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."im_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_message_search" ADD CONSTRAINT "im_message_search_message_id_im_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."im_messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "im_user_search" ADD CONSTRAINT "im_user_search_user_id_im_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."im_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_channel_search_vector" ON "im_channel_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_channel_search_tenant" ON "im_channel_search" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_channel_search_type" ON "im_channel_search" USING btree ("channel_type");--> statement-breakpoint
CREATE INDEX "idx_file_search_vector" ON "im_file_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_file_search_channel" ON "im_file_search" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_file_search_tenant" ON "im_file_search" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_file_search_mime" ON "im_file_search" USING btree ("mime_type");--> statement-breakpoint
CREATE INDEX "idx_message_search_vector" ON "im_message_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_message_search_channel" ON "im_message_search" USING btree ("channel_id");--> statement-breakpoint
CREATE INDEX "idx_message_search_sender" ON "im_message_search" USING btree ("sender_id");--> statement-breakpoint
CREATE INDEX "idx_message_search_tenant" ON "im_message_search" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_message_search_created" ON "im_message_search" USING btree ("message_created_at");--> statement-breakpoint
CREATE INDEX "idx_message_search_tenant_created" ON "im_message_search" USING btree ("tenant_id","message_created_at");--> statement-breakpoint
CREATE INDEX "idx_user_search_vector" ON "im_user_search" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "idx_user_search_status" ON "im_user_search" USING btree ("status");