import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CleanLens · 清洁机器人研究台",
  description: "从产业链到真实业务，以证据理解家庭清洁机器人。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
