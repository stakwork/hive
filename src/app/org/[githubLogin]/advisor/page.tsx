import { AdvisorView } from "@/components/advisor/AdvisorView";

interface AdvisorPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function AdvisorPage({ params }: AdvisorPageProps) {
  const { githubLogin } = await params;
  return (
    <AdvisorView
      embedUrlEndpoint={`/api/orgs/${encodeURIComponent(githubLogin)}/advisor/embed-url`}
    />
  );
}
