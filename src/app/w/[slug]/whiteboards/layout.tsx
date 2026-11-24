import type { Metadata } from "next";

export const metadata: Metadata = { title: "Whiteboards" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
