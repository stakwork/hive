import SwarmDetail from "./SwarmDetail";

export default async function SwarmDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ instanceId: string }>;
  searchParams: Promise<{ swarmUrl?: string; name?: string }>;
}) {
  const { instanceId } = await params;
  const { swarmUrl, name } = await searchParams;

  return <SwarmDetail instanceId={instanceId} swarmUrl={swarmUrl} name={name} />;
}
