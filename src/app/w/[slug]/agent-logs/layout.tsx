import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agent Logs" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
