import type { Metadata } from "next";

export const metadata: Metadata = { title: "Workflow Benchmarks" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
