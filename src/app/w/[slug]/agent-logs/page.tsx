import { redirect } from "next/navigation";

interface AgentLogsPageProps {
  params: Promise<{ slug: string }>;
}

export default async function AgentLogsPage({ params }: AgentLogsPageProps) {
  const { slug } = await params;
  redirect(`/w/${slug}/context/agent-logs`);
}
