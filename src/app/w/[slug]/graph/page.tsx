import { GraphVoicePage } from "./GraphVoicePage";

interface GraphPageProps {
  params: Promise<{
    slug: string;
  }>;
}

export default async function GraphPage({ params }: GraphPageProps) {
  const { slug } = await params;

  return <GraphVoicePage workspaceSlug={slug} />;
}
