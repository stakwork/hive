import { MembersView } from "../_components/MembersView";

interface MembersPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function MembersPage({ params }: MembersPageProps) {
  const { githubLogin } = await params;
  return <MembersView githubLogin={githubLogin} />;
}
