import { GraphView } from "../_components/GraphView";

interface GraphPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function GraphPage({ params }: GraphPageProps) {
  const { githubLogin } = await params;
  return (
    <div className="flex-1 flex flex-col min-h-0 h-full">
      <GraphView githubLogin={githubLogin} />
    </div>
  );
}
