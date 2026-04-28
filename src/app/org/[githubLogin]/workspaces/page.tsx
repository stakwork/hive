import { WorkspacesView } from "../_components/WorkspacesView";

interface WorkspacesPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function WorkspacesPage({ params }: WorkspacesPageProps) {
  const { githubLogin } = await params;
  return <WorkspacesView githubLogin={githubLogin} />;
}
