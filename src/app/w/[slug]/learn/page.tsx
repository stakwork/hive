import { LearnViewer } from "./components/LearnViewer";

interface LearnPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function LearnPage({ params }: LearnPageProps) {
  const { slug } = await params;

  return (
    <div className="flex h-full">
      <LearnViewer workspaceSlug={slug} />
    </div>
  );
}
