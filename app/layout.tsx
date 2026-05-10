import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ChatBotWidget } from "./components/chatbot/ChatBotWidget";
import { PushSetup } from "./components/PushSetup";
import { Providers } from "./components/Providers";
import { SessionTaskNotifier } from "./components/SessionTaskNotifier";
import { Sidebar } from "./components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Claude Code Workflow OS",
  description: "Local control plane for Claude Code workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <main className="min-w-0 flex-1 overflow-x-clip">{children}</main>
          </div>
          <PushSetup />
          <SessionTaskNotifier />
          <ChatBotWidget />
        </Providers>
      </body>
    </html>
  );
}
