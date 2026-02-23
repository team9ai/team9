CREATE TYPE "public"."document_suggestion_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "document_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"from_version_id" uuid NOT NULL,
	"suggested_by" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"summary" text,
	"status" "document_suggestion_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by" jsonb,
	"reviewed_at" timestamp,
	"result_version_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"version_index" integer NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"updated_by" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uq_document_versions_doc_version" UNIQUE("document_id","version_index")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_type" varchar(64) NOT NULL,
	"title" varchar(500),
	"privileges" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"current_version_id" uuid,
	"created_by" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_suggestions" ADD CONSTRAINT "document_suggestions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_suggestions" ADD CONSTRAINT "document_suggestions_from_version_id_document_versions_id_fk" FOREIGN KEY ("from_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_suggestions" ADD CONSTRAINT "document_suggestions_result_version_id_document_versions_id_fk" FOREIGN KEY ("result_version_id") REFERENCES "public"."document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_document_suggestions_document_id" ON "document_suggestions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_document_suggestions_status" ON "document_suggestions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_document_versions_document_id" ON "document_versions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "idx_documents_tenant_id" ON "documents" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "idx_documents_document_type" ON "documents" USING btree ("document_type");