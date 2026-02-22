"use server";
import { sessions } from "@/session/store";
import { requestInfo } from "rwsdk/worker";
import {
  createUser,
  getUserByUsername,
  incrementFailedAttempts,
  resetFailedAttempts,
} from "@/passkey/db";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { calculateLockout, checkRateLimit, formatLockoutMessage } from "./rate-limit";
import { getPostLoginRedirect } from "./redirect";
import { db } from "@/db";

interface AuthResult {
  success: boolean;
  error?: string;
  redirectTo?: string;
}

export async function checkUsername(username: string) {
  const user = await getUserByUsername(username);

  if (!user) {
    return { exists: false, authMethod: null };
  }

  return {
    exists: true,
    authMethod: user.authMethod as "password" | "passkey" | "both",
  };
}

export async function registerWithPassword(
  username: string,
  password: string,
): Promise<AuthResult> {
  const existing = await getUserByUsername(username);
  if (existing) {
    return { success: false, error: "Username already exists" };
  }

  const validation = validatePasswordStrength(password);
  if (!validation.valid) {
    return { success: false, error: validation.errors[0] };
  }

  const passwordHash = await hashPassword(password);

  const user = await createUser(username, {
    authMethod: "password",
    passwordHash,
  });

  const { response } = requestInfo;

  const membership = await db
    .selectFrom("memberships")
    .innerJoin("organizations", "organizations.id", "memberships.organizationId")
    .selectAll("memberships")
    .select(["organizations.id as orgId"])
    .where("memberships.userId", "=", user.id)
    .executeTakeFirst();

  await sessions.save(response.headers, {
    userId: user.id,
    challenge: null,
    currentOrganizationId: membership?.orgId || null,
    role: membership?.role || null,
  });

  return {
    success: true,
    redirectTo: getPostLoginRedirect(0, membership?.role),
  };
}

export async function loginWithPassword(
  username: string,
  password: string,
): Promise<AuthResult> {
  const user = await getUserByUsername(username);
  const genericError = "Invalid username or password";

  if (!user) {
    return { success: false, error: genericError };
  }

  if (user.authMethod !== "password" && user.authMethod !== "both") {
    return { success: false, error: "This account uses passkey authentication" };
  }

  const rateLimit = checkRateLimit({
    failedLoginAttempts: user.failedLoginAttempts,
    lockoutUntil: user.lockoutUntil,
  });

  if (!rateLimit.allowed) {
    if (rateLimit.lockedUntil) {
      return { success: false, error: formatLockoutMessage(rateLimit.lockedUntil) };
    }
    return { success: false, error: "Too many failed attempts. Please try again later." };
  }

  if (!user.passwordHash) {
    return { success: false, error: genericError };
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    const newAttempts = user.failedLoginAttempts + 1;
    const lockout = calculateLockout(newAttempts);
    await incrementFailedAttempts(user.id, lockout);

    if (lockout) {
      return { success: false, error: formatLockoutMessage(new Date(lockout)) };
    }

    const remaining = 5 - newAttempts;
    if (remaining > 0) {
      return { success: false, error: `${genericError}. ${remaining} attempts remaining.` };
    }

    return { success: false, error: genericError };
  }

  await resetFailedAttempts(user.id);

  const { response } = requestInfo;

  const membership = await db
    .selectFrom("memberships")
    .innerJoin("organizations", "organizations.id", "memberships.organizationId")
    .selectAll("memberships")
    .select(["organizations.id as orgId"])
    .where("memberships.userId", "=", user.id)
    .executeTakeFirst();

  await sessions.save(response.headers, {
    userId: user.id,
    challenge: null,
    currentOrganizationId: membership?.orgId || null,
    role: membership?.role || null,
  });

  return {
    success: true,
    redirectTo: getPostLoginRedirect(user.isPlatformAdmin, membership?.role),
  };
}
