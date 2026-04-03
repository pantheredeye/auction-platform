"use server";
import {
  AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";

import { sessions } from "@/session/store";
import { env } from "cloudflare:workers";
import { requestInfo } from "rwsdk/worker";
import {
  createCredential,
  createUser,
  getCredentialById,
  getUserById,
  getUserByUsername,
  updateCredentialCounter,
} from "./db";
import { getPostLoginRedirect } from "@/auth/redirect";

function getWebAuthnConfig(request: Request) {
  const rpID = import.meta.env.VITE_IS_DEV_SERVER
    ? new URL(request.url).hostname
    : env.WEBAUTHN_RP_ID ?? new URL(request.url).hostname;
  const rpName = import.meta.env.VITE_IS_DEV_SERVER
    ? "Development App"
    : env.WEBAUTHN_APP_NAME;
  return { rpName, rpID };
}

export async function startPasskeyRegistration(username: string) {
  const { rpName, rpID } = getWebAuthnConfig(requestInfo.request);
  const { response } = requestInfo;

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: username,
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "preferred",
    },
  });

  await sessions.save(response.headers, { challenge: options.challenge });

  return options;
}

export async function startPasskeyLogin() {
  const { rpID } = getWebAuthnConfig(requestInfo.request);
  const { response } = requestInfo;

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });

  await sessions.save(response.headers, { challenge: options.challenge });

  return options;
}

export async function finishPasskeyRegistration(
  username: string,
  registration: RegistrationResponseJSON,
) {
  const { request, response } = requestInfo;
  const { origin } = new URL(request.url);
  const { rpID } = getWebAuthnConfig(request);

  const session = await sessions.load(request);
  const challenge = session?.challenge;

  if (!challenge) {
    return { success: false };
  }

  const verification = await verifyRegistrationResponse({
    response: registration,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    return { success: false };
  }

  await sessions.save(response.headers, { challenge: null });

  const existing = await getUserByUsername(username);
  if (existing) {
    return { success: false };
  }

  const user = await createUser(username, { authMethod: "passkey" });

  await createCredential({
    userId: user.id,
    credentialId: verification.registrationInfo.credential.id,
    publicKey: verification.registrationInfo.credential.publicKey,
    counter: verification.registrationInfo.credential.counter,
  });

  const { db } = await import("@/db");
  const membership = await db
    .selectFrom("memberships")
    .innerJoin(
      "organizations",
      "organizations.id",
      "memberships.organizationId",
    )
    .selectAll("memberships")
    .select(["organizations.id as orgId"])
    .where("memberships.userId", "=", user.id)
    .executeTakeFirst();

  await sessions.save(response.headers, {
    userId: user.id,
    challenge: null,
    currentOrganizationId: membership?.orgId || null,
    role: membership?.role || null,
  }, { maxAge: true });

  return {
    success: true,
    redirectTo: getPostLoginRedirect(0, membership?.role),
  };
}

export async function finishPasskeyLogin(login: AuthenticationResponseJSON) {
  const { request, response } = requestInfo;
  const { origin } = new URL(request.url);
  const { rpID } = getWebAuthnConfig(request);

  const session = await sessions.load(request);
  const challenge = session?.challenge;

  if (!challenge) {
    return { success: false };
  }

  const credential = await getCredentialById(login.id);

  if (!credential) {
    return { success: false };
  }

  const verification = await verifyAuthenticationResponse({
    response: login,
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: credential.credentialId,
      publicKey: credential.publicKey.slice(),
      counter: credential.counter,
    },
  });

  if (!verification.verified) {
    return { success: false };
  }

  await updateCredentialCounter(
    login.id,
    verification.authenticationInfo.newCounter,
  );

  const user = await getUserById(credential.userId);

  if (!user) {
    return { success: false };
  }

  const { db } = await import("@/db");
  const membership = await db
    .selectFrom("memberships")
    .innerJoin(
      "organizations",
      "organizations.id",
      "memberships.organizationId",
    )
    .selectAll("memberships")
    .select(["organizations.id as orgId"])
    .where("memberships.userId", "=", user.id)
    .executeTakeFirst();

  await sessions.save(response.headers, {
    userId: user.id,
    challenge: null,
    currentOrganizationId: membership?.orgId || null,
    role: membership?.role || null,
  }, { maxAge: true });

  return {
    success: true,
    redirectTo: getPostLoginRedirect(user.isPlatformAdmin, membership?.role),
  };
}
