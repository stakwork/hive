import { GatewayView } from "../_components/GatewayView";

interface GatewayPageProps {
  params: Promise<{ githubLogin: string }>;
}

export default async function GatewayPage({ params }: GatewayPageProps) {
  const { githubLogin } = await params;
  return <GatewayView githubLogin={githubLogin} />;
}
