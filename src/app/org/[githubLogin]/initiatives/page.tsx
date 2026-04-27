import { OrgInitiatives } from "../OrgInitiatives";

interface InitiativesPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function InitiativesPage({ params }: InitiativesPageProps) {
  const { githubLogin } = await params;
  return <OrgInitiatives githubLogin={githubLogin} />;
}
