import { db } from "@/db";
import type { AppDatabase } from "@/db";

type TableWithIdempotencyKey = {
  [K in keyof AppDatabase]: AppDatabase[K] extends { idempotencyKey: string }
    ? K
    : never;
}[keyof AppDatabase];

export async function checkIdempotency(
  table: TableWithIdempotencyKey,
  key: string,
): Promise<boolean> {
  const result = await db
    .selectFrom(table)
    .select("idempotencyKey")
    .where("idempotencyKey", "=", key)
    .executeTakeFirst();

  return !!result;
}
