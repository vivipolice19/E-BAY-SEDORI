import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { appSettings } from "@shared/schema";
import type { AppSettings } from "@shared/schema";

const SETTINGS_ROW_ID = "default";

let pool: pg.Pool | null = null;
let db: ReturnType<typeof drizzle> | null = null;

function getDb() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) return null;
  if (!pool) pool = new pg.Pool({ connectionString: url, max: 5 });
  if (!db) db = drizzle(pool, { schema: { appSettings } });
  return db;
}

export async function loadPersistedSettings(): Promise<AppSettings | null> {
  const database = getDb();
  if (!database) return null;
  const rows = await database.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ROW_ID)).limit(1);
  return rows[0] ?? null;
}

export async function savePersistedSettings(settings: AppSettings): Promise<void> {
  const database = getDb();
  if (!database) return;
  const { id: _id, ...rest } = settings;
  await database
    .insert(appSettings)
    .values({ ...settings, id: SETTINGS_ROW_ID })
    .onConflictDoUpdate({
      target: appSettings.id,
      set: rest,
    });
}
