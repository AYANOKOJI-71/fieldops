CREATE TYPE "public"."sync_entity_type" AS ENUM('work_order', 'visit');--> statement-breakpoint
CREATE TYPE "public"."sync_operation" AS ENUM('create', 'update', 'resolve_conflict');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."work_order_priority" AS ENUM('low', 'standard', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."work_order_status" AS ENUM('scheduled', 'in_progress', 'completed', 'needs_review');--> statement-breakpoint
CREATE TABLE "field_visits" (
	"id" varchar(96) PRIMARY KEY NOT NULL,
	"owner_open_id" varchar(128) NOT NULL,
	"work_order_id" varchar(96) NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"notes" text DEFAULT '' NOT NULL,
	"checklist" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_work_orders" (
	"id" varchar(96) PRIMARY KEY NOT NULL,
	"owner_open_id" varchar(128) NOT NULL,
	"customer_name" text NOT NULL,
	"service_site" text NOT NULL,
	"address" text NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"priority" "work_order_priority" NOT NULL,
	"status" "work_order_status" NOT NULL,
	"description" text NOT NULL,
	"equipment" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" varchar(128) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_mutation_ledger" (
	"client_mutation_id" varchar(128) PRIMARY KEY NOT NULL,
	"owner_open_id" varchar(128) NOT NULL,
	"entity_type" "sync_entity_type" NOT NULL,
	"entity_id" varchar(96) NOT NULL,
	"operation" "sync_operation" NOT NULL,
	"applied_version" integer NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"open_id" varchar(128) NOT NULL,
	"name" text,
	"email" varchar(320),
	"login_method" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_signed_in" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_open_id_unique" UNIQUE("open_id")
);
--> statement-breakpoint
CREATE INDEX "field_visits_owner_updated_idx" ON "field_visits" USING btree ("owner_open_id","updated_at");--> statement-breakpoint
CREATE INDEX "field_visits_owner_work_order_idx" ON "field_visits" USING btree ("owner_open_id","work_order_id");--> statement-breakpoint
CREATE INDEX "field_work_orders_owner_updated_idx" ON "field_work_orders" USING btree ("owner_open_id","updated_at");--> statement-breakpoint
CREATE INDEX "sync_mutation_ledger_owner_idx" ON "sync_mutation_ledger" USING btree ("owner_open_id");