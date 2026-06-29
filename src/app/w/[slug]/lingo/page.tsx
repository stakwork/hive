import { LingoExplorer } from "./components/LingoExplorer";

interface LingoPageProps {
  params: Promise<{ slug: string }>;
}

export default async function LingoPage({ params }: LingoPageProps) {
  const { slug } = await params;
  return (
    <div className="flex h-full">
      <LingoExplorer workspaceSlug={slug} />
    </div>
  );
}
