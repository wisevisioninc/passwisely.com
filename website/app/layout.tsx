import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://passwisely.com"),
  title: {
    default: "PassWisely — AI Interview Copilot",
    template: "%s · PassWisely",
  },
  description:
    "A private AI desktop copilot for technical interviews, coding problems, system design, and resume preparation.",
  icons: {
    icon: [
      { url: "/favicon.ico" },
      {
        url: "/passwisely-logo-192.png",
        type: "image/png",
        sizes: "192x192",
      },
    ],
    shortcut: "/favicon.ico",
    apple: "/passwisely-logo-192.png",
  },
  openGraph: {
    title: "PassWisely — Think clearly under pressure",
    description:
      "A cross-platform AI interview copilot for screenshots, coding, system design, and resume preparation.",
    type: "website",
    locale: "zh_CN",
    alternateLocale: "en_US",
    siteName: "PassWisely",
    images: [
      {
        url: "/og-premium.png",
        width: 1672,
        height: 941,
        alt: "PassWisely — 实时AI面试隐身助手",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PassWisely — AI Interview Copilot",
    description: "Think clearly under pressure with a private desktop copilot.",
    images: ["/og-premium.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
