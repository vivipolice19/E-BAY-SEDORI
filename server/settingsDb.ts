import { eq } from "drizzle-orm";
import { appSettings } from "@shared/schema";
import type { AppSettings } from "@shared/schema";
import { getPersistDb } from "./database";

const SETTINGS_ROW_ID = "default";

export async function loadPersistedSettings(): Promise<AppSettings | null> {
  const database = getPersistDb();
  if (!database) return null;
  const rows = await database.select().from(appSettings).where(eq(appSettings.id, SETTINGS_ROW_ID)).limit(1);
  return rows[0] ?? null;
}

export async function savePersistedSettings(settings: AppSettings): Promise<void> {
  const database = getPersistDb();
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
