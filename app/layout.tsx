import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") ?? "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const base = new URL(`${protocol}://${host}`);

  return {
    metadataBase: base,
    title: {
      default: "Ритм сада",
      template: "%s — Ритм сада",
    },
    description:
      "Спокойный помощник по уходу за садом: план участка, сезонные дела и календарь цветения.",
    applicationName: "Ритм сада",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Ритм сада",
    },
    icons: {
      icon: "/icon.png",
      shortcut: "/icon.png",
      apple: "/icon.png",
    },
    openGraph: {
      title: "Ритм сада",
      description: "Что важно сделать сегодня — и почему",
      type: "website",
      locale: "ru_RU",
      images: [
        {
          url: new URL("/og.png", base).toString(),
          width: 1744,
          height: 909,
          alt: "Ритм сада — план участка и дела на сегодня",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "Ритм сада",
      description: "Что важно сделать сегодня — и почему",
      images: [new URL("/og.png", base).toString()],
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#f4f2e8",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
