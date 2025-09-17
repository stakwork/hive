import { LearnChat } from "./components/LearnChat";

interface LearnPageProps {
  params: {
    slug: string;
  };
}

export default function LearnPage({ params }: LearnPageProps) {
  return (
    <div className="flex-1 flex flex-col h-full">
      <LearnChat workspaceSlug={params.slug} />
    </div>
  );
}