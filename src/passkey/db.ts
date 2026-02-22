"use server";
import { db } from "@/db";

export async function createUser(
  username: string,
  options?: {
    authMethod?: "password" | "passkey" | "both";
    passwordHash?: string;
  },
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const normalizedUsername = username.toLowerCase().trim();

  await db
    .insertInto("users")
    .values({
      id,
      username: normalizedUsername,
      createdAt: now,
      authMethod: options?.authMethod || "passkey",
      passwordHash: options?.passwordHash || null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
      isPlatformAdmin: 0,
    })
    .execute();

  // Find first org to add user to as consumer
  const org = await db
    .selectFrom("organizations")
    .selectAll()
    .executeTakeFirst();

  if (org) {
    await db
      .insertInto("memberships")
      .values({
        id: crypto.randomUUID(),
        userId: id,
        organizationId: org.id,
        role: "consumer",
        isApproved: 1,
        createdAt: now,
      })
      .execute();
  }

  return { id, username: normalizedUsername, createdAt: now };
}

export async function createCredential({
  userId,
  credentialId,
  publicKey,
  counter,
}: {
  userId: string;
  credentialId: string;
  publicKey: Uint8Array;
  counter: number;
}) {
  const id = crypto.randomUUID();
  await db
    .insertInto("credentials")
    .values({
      id,
      userId,
      credentialId,
      publicKey: Buffer.from(publicKey).toString("base64"),
      counter,
      createdAt: new Date().toISOString(),
    })
    .execute();

  return { id };
}

export async function getUserById(id: string) {
  return await db
    .selectFrom("users")
    .selectAll()
    .where("id", "=", id)
    .where("deletedAt", "is", null)
    .executeTakeFirst();
}

export async function getCredentialById(credentialId: string) {
  const cred = await db
    .selectFrom("credentials")
    .selectAll()
    .where("credentialId", "=", credentialId)
    .executeTakeFirst();

  if (!cred) return null;

  return {
    ...cred,
    publicKey: Uint8Array.from(Buffer.from(cred.publicKey, "base64")),
  };
}

export async function updateCredentialCounter(
  credentialId: string,
  counter: number,
) {
  await db
    .updateTable("credentials")
    .set({ counter })
    .where("credentialId", "=", credentialId)
    .execute();
}

export async function getUserByUsername(username: string) {
  const normalizedUsername = username.toLowerCase().trim();

  return await db
    .selectFrom("users")
    .selectAll()
    .where("username", "=", normalizedUsername)
    .where("deletedAt", "is", null)
    .executeTakeFirst();
}

export async function incrementFailedAttempts(
  userId: string,
  lockoutUntil: string | null,
) {
  await db
    .updateTable("users")
    .set(({ eb }) => ({
      failedLoginAttempts: eb("failedLoginAttempts", "+", 1),
      lockoutUntil,
    }))
    .where("id", "=", userId)
    .execute();
}

export async function resetFailedAttempts(userId: string) {
  await db
    .updateTable("users")
    .set({
      failedLoginAttempts: 0,
      lockoutUntil: null,
    })
    .where("id", "=", userId)
    .execute();
}
