import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function currentUserKey(): Promise<string | null> {
  const user = await getChatGPTUser();
  if (user) return user.email.toLowerCase();

  const configuredUser = process.env.GARDEN_SINGLE_USER_KEY?.trim();
  if (configuredUser) return configuredUser;

  return process.env.NODE_ENV === "production" ? null : "local-preview";
}
