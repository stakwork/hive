import type { Metadata } from "next";

export const metadata: Metadata = { title: "Errors" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
