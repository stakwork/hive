import { redirect } from "next/navigation";

export default async function LongMemoryBenchmarksRedirect({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  redirect(`/w/${slug}/apps/longmemory-benchmarks`);
}
