import { StrutView } from "@/components/strut/StrutView";

interface StrutPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function StrutPage({ params }: StrutPageProps) {
  const { githubLogin } = await params;
  return (
    <StrutView
      embedUrlEndpoint={`/api/orgs/${encodeURIComponent(githubLogin)}/strut/embed-url`}
    />
  );
}
