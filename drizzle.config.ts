import { defineConfig } from "drizzle-kit";

const connectionString = process.env.FIELD_SERVICE_POSTGRES_URL;
if (!connectionString) throw new Error("FIELD_SERVICE_POSTGRES_URL is required to run PostgreSQL drizzle commands");

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: connectionString },
});
