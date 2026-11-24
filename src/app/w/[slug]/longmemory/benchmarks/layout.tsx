import type { Metadata } from "next";

export const metadata: Metadata = { title: "Long Memory Benchmarks" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
