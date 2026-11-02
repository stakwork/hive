import { notFound } from "next/navigation";
import { isLongMemoryWorkspace } from "@/lib/eval-capture-slugs";

/** The LongMemory page exists in `openlaw-1` only; any other workspace gets a 404. */
export default async function LongMemoryBenchmarksLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  if (!isLongMemoryWorkspace(slug)) notFound();
  return children;
}
