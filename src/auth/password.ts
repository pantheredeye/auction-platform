/**
 * Password hashing and validation utilities using Web Crypto API
 * Uses PBKDF2 with 100k iterations (Cloudflare Workers max)
 */

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

interface PasswordValidation {
  valid: boolean;
  errors: string[];
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    KEY_LENGTH * 8
  );

  const hashBytes = new Uint8Array(hashBuffer);
  const combined = new Uint8Array(salt.length + hashBytes.length);
  combined.set(salt);
  combined.set(hashBytes, salt.length);

  return btoa(String.fromCharCode(...combined));
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  try {
    const combined = Uint8Array.from(atob(storedHash), c => c.charCodeAt(0));

    if (combined.length !== SALT_LENGTH + KEY_LENGTH) {
      return false;
    }

    const salt = combined.slice(0, SALT_LENGTH);
    const storedHashBytes = combined.slice(SALT_LENGTH);

    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);

    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      passwordBytes,
      "PBKDF2",
      false,
      ["deriveBits"]
    );

    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: PBKDF2_ITERATIONS,
        hash: "SHA-256",
      },
      keyMaterial,
      KEY_LENGTH * 8
    );

    const hashBytes = new Uint8Array(hashBuffer);

    if (hashBytes.length !== storedHashBytes.length) {
      return false;
    }

    let result = 0;
    for (let i = 0; i < hashBytes.length; i++) {
      result |= hashBytes[i] ^ storedHashBytes[i];
    }

    return result === 0;
  } catch (error) {
    console.error("Password verification error:", error);
    return false;
  }
}

export function validatePasswordStrength(password: string): PasswordValidation {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push("Password must be at least 12 characters");
  }
  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain lowercase letters");
  }
  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain uppercase letters");
  }
  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain numbers");
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    errors.push("Password must contain special characters");
  }

  return { valid: errors.length === 0, errors };
}

export function getPasswordStrength(password: string): number {
  let strength = 0;
  if (password.length >= 12) strength++;
  if (password.length >= 16) strength++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) strength++;
  if (/[0-9]/.test(password)) strength++;
  if (/[^a-zA-Z0-9]/.test(password)) strength++;
  return Math.min(strength, 4);
}
