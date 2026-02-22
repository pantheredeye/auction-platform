const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

interface RateLimitResult {
  allowed: boolean;
  lockedUntil?: Date;
  remainingAttempts?: number;
}

export function checkRateLimit(user: {
  failedLoginAttempts: number;
  lockoutUntil: string | null;
}): RateLimitResult {
  const now = Date.now();

  if (user.lockoutUntil && new Date(user.lockoutUntil).getTime() > now) {
    return {
      allowed: false,
      lockedUntil: new Date(user.lockoutUntil),
    };
  }

  if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
    return {
      allowed: false,
      remainingAttempts: 0,
    };
  }

  return {
    allowed: true,
    remainingAttempts: MAX_FAILED_ATTEMPTS - user.failedLoginAttempts,
  };
}

export function calculateLockout(currentAttempts: number): string | null {
  if (currentAttempts >= MAX_FAILED_ATTEMPTS) {
    return new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
  }
  return null;
}

export function formatLockoutMessage(lockedUntil: Date): string {
  const now = new Date();
  const diffMs = lockedUntil.getTime() - now.getTime();
  const diffMinutes = Math.ceil(diffMs / 60000);

  if (diffMinutes <= 1) {
    return "Account locked. Try again in less than a minute.";
  }
  return `Account locked. Try again in ${diffMinutes} minutes.`;
}
