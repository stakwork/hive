import type { Metadata } from "next";
import { LearnViewer } from "./components/LearnViewer";

interface LearnPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export const metadata: Metadata = { title: "Learn" };

export default async function LearnPage({ params }: LearnPageProps) {
  const { slug } = await params;

  return (
    <div className="flex h-full">
      <LearnViewer workspaceSlug={slug} />
    </div>
  );
}
