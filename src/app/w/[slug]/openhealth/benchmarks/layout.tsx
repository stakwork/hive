import type { Metadata } from "next";

export const metadata: Metadata = { title: "OpenHealth Benchmarks" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
