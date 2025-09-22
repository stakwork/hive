import { LearnChat } from "./components/LearnChat";

interface LearnPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function LearnPage({ params }: LearnPageProps) {
  const { slug } = await params;

  return (
    <div className="flex-1 flex flex-col h-full">
      <LearnChat workspaceSlug={slug} />
    </div>
  );
}