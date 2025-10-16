import { RepositoryCard, TestCoverageCard } from "@/components/dashboard";
import { RecentTasksCard } from "@/components/dashboard/recent-tasks-card";
import { VMConfigSection } from "@/components/pool-status";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspace } from "@/hooks/useWorkspace";
import { GraphComponent } from "../graph";
import { Gitsee } from "../graph/gitsee";

interface DashboardProps {
  setupInProgress?: boolean;
}

export function Dashboard({ setupInProgress = false }: DashboardProps) {

  const { workspace } = useWorkspace();

  const description = setupInProgress
    ? "Your workspace is being configured. You can start exploring while setup completes in the background."
    : "Welcome to your development workspace.";

  const repository = workspace?.repositories[0];

  return (
    <>
      <PageHeader title="Dashboard" description={description} />

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        <VMConfigSection />
        <RepositoryCard />
        <TestCoverageCard />
      </div>

      <RecentTasksCard />

      {repository?.status === 'SYNCED' ? <GraphComponent /> : <Gitsee />}
    </>
  );
}