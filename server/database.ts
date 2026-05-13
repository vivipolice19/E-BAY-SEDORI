import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

/** Postgres 用の単一プール（設定・商品などで共有） */
export function getPersistDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 8 });
  if (!db) db = drizzle(pool, { schema });
  return db;
}
