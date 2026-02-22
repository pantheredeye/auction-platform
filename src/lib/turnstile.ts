import { env } from "cloudflare:workers";

export async function verifyTurnstile(
  token: string,
  ip?: string,
): Promise<boolean> {
  const secretKey = (env as any).TURNSTILE_SECRET_KEY;
  if (!secretKey) return true; // Skip verification if no key configured

  const formData = new URLSearchParams();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (ip) formData.append("remoteip", ip);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    },
  );

  const data = (await response.json()) as { success: boolean };
  return data.success;
}
