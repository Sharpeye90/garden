import type { Metadata } from "next";
import { GardenApp } from "./components/GardenApp";
import { emailDeliveryConfigured } from "./lib/email";
import { currentGardenUser } from "./lib/server-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ритм сада — дела на участке сегодня",
  description:
    "Персональный план участка, календарь ухода и цветения для садоводов Московской, Тверской и Владимирской областей.",
};

export default async function Home() {
  const user = await currentGardenUser();

  return (
    <GardenApp
      userName={user?.fullName?.split(" ")[0] ?? user?.displayName ?? "Гость"}
      userEmail={user?.email ?? null}
      isPreview={!user}
      emailDeliveryEnabled={emailDeliveryConfigured()}
    />
  );
}
