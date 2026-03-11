"use server";
import { db } from "@/db";

export async function createBidder({
  name,
  email,
  guestId,
}: {
  name: string;
  email: string;
  guestId: string;
}): Promise<{ userId: string; userName: string }> {
  if (!name?.trim()) throw new Error("Name is required");
  if (!email?.trim()) throw new Error("Email is required");
  if (!guestId?.trim()) throw new Error("Guest ID is required");

  const normalizedEmail = email.toLowerCase().trim();
  const trimmedName = name.trim();
  const now = new Date().toISOString();

  // Check for existing user by username (email)
  const existingUser = await db
    .selectFrom("users")
    .selectAll()
    .where("username", "=", normalizedEmail)
    .where("deletedAt", "is", null)
    .executeTakeFirst();

  let userId: string;

  if (existingUser) {
    userId = existingUser.id;

    // Update displayName if different
    if (existingUser.displayName !== trimmedName) {
      await db
        .updateTable("users")
        .set({ displayName: trimmedName })
        .where("id", "=", userId)
        .execute();
    }
  } else {
    // Create new bidder user
    userId = crypto.randomUUID();

    await db
      .insertInto("users")
      .values({
        id: userId,
        username: normalizedEmail,
        name: trimmedName,
        displayName: trimmedName,
        authMethod: "bidder",
        failedLoginAttempts: 0,
        lockoutUntil: null,
        isPlatformAdmin: 0,
        createdAt: now,
      })
      .execute();
  }

  // Create bidder_registration linking guestId to userId
  await db
    .insertInto("bidder_registrations")
    .values({
      id: crypto.randomUUID(),
      guestId,
      userId,
      createdAt: now,
    })
    .execute();

  return { userId, userName: trimmedName };
}
