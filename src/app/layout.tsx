import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClawTreasury | Tether WDK Command Center",
  description:
    "Terminal-chic treasury dashboard for Claw, an autonomous agent using Tether WDK for non-custodial USDT policy, approvals, and execution.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="bg-[#0A0A0B]">
      <body className="font-sans">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
