"use server";
import { env } from "cloudflare:workers";
import { db } from "@/db";
import { getStripe } from "@/stripe/client";
import { requestInfo } from "rwsdk/worker";
import { verifyTurnstile } from "@/lib/turnstile";

export async function createBidder({
  name,
  email,
  guestId,
  acceptedTermsVersion,
  turnstileToken,
}: {
  name: string;
  email: string;
  guestId: string;
  acceptedTermsVersion?: string;
  turnstileToken?: string;
}): Promise<{ userId: string; userName: string }> {
  if (!name?.trim()) throw new Error("Name is required");
  if (!email?.trim()) throw new Error("Email is required");
  if (!guestId?.trim()) throw new Error("Guest ID is required");

  // Verify Turnstile captcha
  const ip = requestInfo.request.headers.get("CF-Connecting-IP") ?? undefined;
  if (turnstileToken) {
    const valid = await verifyTurnstile(turnstileToken, ip);
    if (!valid) throw new Error("Captcha verification failed");
  }

  const normalizedEmail = email.toLowerCase().trim();
  const trimmedName = name.trim();
  const now = new Date().toISOString();

  // Rate limit: max 3 registrations per guestId per hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await db
    .selectFrom("bidder_registrations")
    .select(db.fn.countAll().as("count"))
    .where("guestId", "=", guestId)
    .where("createdAt", ">", oneHourAgo)
    .executeTakeFirstOrThrow();

  if (Number(count) >= 3) {
    throw new Error("Too many registration attempts. Please try again later.");
  }

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

  // Create bidder_registration — handle duplicate (guestId, userId) gracefully
  await db
    .insertInto("bidder_registrations")
    .values({
      id: crypto.randomUUID(),
      guestId,
      userId,
      createdAt: now,
    })
    .onConflict((oc) => oc.columns(["guestId", "userId"]).doNothing())
    .execute();

  // Record terms acceptance if provided
  if (acceptedTermsVersion) {
    const request = requestInfo.request;
    const ipAddress =
      request.headers.get("CF-Connecting-IP") ??
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
      "unknown";

    await db
      .insertInto("terms_acceptances")
      .values({
        id: crypto.randomUUID(),
        userId,
        termsType: "platform",
        termsVersion: acceptedTermsVersion,
        organizationId: "",
        acceptedAt: now,
        ipAddress,
      })
      .execute();
  }

  return { userId, userName: trimmedName };
}

export async function createBidderAndSetupIntent({
  name,
  email,
  guestId,
  acceptedTermsVersion,
  turnstileToken,
}: {
  name: string;
  email: string;
  guestId: string;
  acceptedTermsVersion?: string;
  turnstileToken?: string;
}): Promise<{
  userId: string;
  clientSecret: string;
  publishableKey: string;
}> {
  // Reuse createBidder for user + bidder_registration creation
  const { userId } = await createBidder({ name, email, guestId, acceptedTermsVersion, turnstileToken });

  const stripe = getStripe(env.STRIPE_SECRET_KEY);
  const normalizedEmail = email.toLowerCase().trim();
  const trimmedName = name.trim();

  // Check if user already has a Stripe Customer
  const user = await db
    .selectFrom("users")
    .select(["stripeCustomerId"])
    .where("id", "=", userId)
    .executeTakeFirstOrThrow();

  let customerId = user.stripeCustomerId;

  if (!customerId) {
    // Create new Stripe Customer
    const customer = await stripe.customers.create({
      email: normalizedEmail,
      name: trimmedName,
      metadata: { userId, guestId },
    });
    customerId = customer.id;

    // Store stripeCustomerId on user
    await db
      .updateTable("users")
      .set({ stripeCustomerId: customerId })
      .where("id", "=", userId)
      .execute();
  }

  // Create SetupIntent for future off-session payments
  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    usage: "off_session",
    automatic_payment_methods: { enabled: true },
  });

  return {
    userId,
    clientSecret: setupIntent.client_secret!,
    publishableKey: env.STRIPE_PUBLISHABLE_KEY,
  };
}

export async function savePaymentMethod({
  userId,
  guestId,
  stripePaymentMethodId,
}: {
  userId: string;
  guestId: string;
  stripePaymentMethodId: string;
}): Promise<{ success: true }> {
  if (!userId?.trim()) throw new Error("userId is required");
  if (!guestId?.trim()) throw new Error("guestId is required");
  if (!stripePaymentMethodId?.trim())
    throw new Error("stripePaymentMethodId is required");

  // Verify the caller owns this userId via bidder_registrations
  const registration = await db
    .selectFrom("bidder_registrations")
    .select("id")
    .where("guestId", "=", guestId)
    .where("userId", "=", userId)
    .executeTakeFirst();
  if (!registration) {
    throw new Error("Unauthorized: registration not found for this guest");
  }

  const stripe = getStripe(env.STRIPE_SECRET_KEY);
  const pm = await stripe.paymentMethods.retrieve(stripePaymentMethodId);
  const card = pm.card;
  if (!card) throw new Error("Payment method has no card details");

  const now = new Date().toISOString();

  await db
    .insertInto("payment_methods")
    .values({
      id: crypto.randomUUID(),
      userId,
      stripePaymentMethodId,
      last4: card.last4,
      brand: card.brand,
      expMonth: card.exp_month,
      expYear: card.exp_year,
      isDefault: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .execute();

  return { success: true };
}

export async function getBidderStatus(guestId: string): Promise<{
  registered: boolean;
  hasCard: boolean;
  userId?: string;
  userName?: string;
  userEmail?: string;
}> {
  if (!guestId?.trim()) return { registered: false, hasCard: false };

  const registration = await db
    .selectFrom("bidder_registrations")
    .selectAll()
    .where("guestId", "=", guestId)
    .executeTakeFirst();

  if (!registration) return { registered: false, hasCard: false };

  const user = await db
    .selectFrom("users")
    .select(["displayName", "username"])
    .where("id", "=", registration.userId)
    .executeTakeFirst();

  const activeMethod = await db
    .selectFrom("payment_methods")
    .selectAll()
    .where("userId", "=", registration.userId)
    .where("status", "=", "active")
    .executeTakeFirst();

  return {
    registered: true,
    hasCard: !!activeMethod,
    userId: registration.userId,
    userName: user?.displayName ?? undefined,
    userEmail: user?.username ?? undefined,
  };
}
