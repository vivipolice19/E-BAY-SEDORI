import { desc, eq } from "drizzle-orm";
import { savedProducts } from "@shared/schema";
import type { SavedProduct } from "@shared/schema";
import { getPersistDb } from "./database";

/** Drizzle / PG が undefined を嫌うため null にそろえる */
function coerceProductRow(p: SavedProduct): Record<string, unknown> {
  const o = { ...p } as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (o[k] === undefined) o[k] = null;
  }
  return o;
}

export async function loadAllSavedProductsFromDb(): Promise<SavedProduct[]> {
  const database = getPersistDb();
  if (!database) return [];
  return database.select().from(savedProducts).orderBy(desc(savedProducts.createdAt));
}

export async function replaceSavedProductRow(row: SavedProduct): Promise<void> {
  const database = getPersistDb();
  if (!database) return;
  const full = coerceProductRow(row) as unknown as SavedProduct;
  const { id: _id, ...rest } = full;
  await database
    .insert(savedProducts)
    .values(full)
    .onConflictDoUpdate({
      target: savedProducts.id,
      set: rest as Record<string, unknown>,
    });
}

export async function deleteSavedProductRow(id: string): Promise<void> {
  const database = getPersistDb();
  if (!database) return;
  await database.delete(savedProducts).where(eq(savedProducts.id, id));
}
