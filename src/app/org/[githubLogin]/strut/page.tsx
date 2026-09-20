import { StrutView } from "../_components/StrutView";

interface StrutPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function StrutPage({ params }: StrutPageProps) {
  const { githubLogin } = await params;
  return <StrutView githubLogin={githubLogin} />;
}
