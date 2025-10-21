import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Cache the database connection in development. This avoids creating a new connection on every HMR
 * update.
 */
const globalForDb = globalThis as unknown as {
	conn: postgres.Sql | undefined;
};

const databaseUrl = process.env.SUPABASE_DATABASE_URL;
if (!databaseUrl) {
	throw new Error("SUPABASE_DATABASE_URL environment variable is not set");
}

const conn = globalForDb.conn ?? postgres(databaseUrl, { prepare: false });
if (process.env.NODE_ENV !== "production") globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
export type DrizzleDb = typeof db;
