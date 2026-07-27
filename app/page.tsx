import type { Metadata } from "next";
import { getChatGPTUser } from "./chatgpt-auth";
import { GardenApp } from "./components/GardenApp";
import { isPublicDemoRequest } from "./lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ритм сада — дела на участке сегодня",
  description:
    "Персональный план участка, календарь ухода и цветения для садоводов Московской и Тверской областей.",
};

export default async function Home() {
  const user = await getChatGPTUser();
  const isPublicDemo = await isPublicDemoRequest();
  const singleUserName = process.env.GARDEN_SINGLE_USER_NAME?.trim();
  const hasSingleUser = Boolean(process.env.GARDEN_SINGLE_USER_KEY?.trim());

  return (
    <GardenApp
      userName={
        isPublicDemo
          ? "Гость"
          : user?.fullName?.split(" ")[0] ?? singleUserName ?? "Анна"
      }
      isPreview={isPublicDemo || (!user && !hasSingleUser)}
    />
  );
}
