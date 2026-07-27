import { getChatGPTUser } from "@/app/chatgpt-auth";
import { headers } from "next/headers";

function normalizedHost(value: string | null): string | null {
  if (!value) return null;
  const firstHost = value.split(",")[0]?.trim().toLowerCase();
  if (!firstHost) return null;
  return firstHost.startsWith("[")
    ? firstHost.slice(0, firstHost.indexOf("]") + 1)
    : firstHost.split(":")[0];
}

export async function isPublicDemoRequest(): Promise<boolean> {
  const publicHost = normalizedHost(process.env.GARDEN_PUBLIC_HOST ?? null);
  if (!publicHost) return false;

  const requestHeaders = await headers();
  const requestHost = normalizedHost(
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
  );
  return requestHost === publicHost;
}

export async function currentUserKey(): Promise<string | null> {
  if (await isPublicDemoRequest()) return null;

  const user = await getChatGPTUser();
  if (user) return user.email.toLowerCase();

  const configuredUser = process.env.GARDEN_SINGLE_USER_KEY?.trim();
  if (configuredUser) return configuredUser;

  return process.env.NODE_ENV === "production" ? null : "local-preview";
}
