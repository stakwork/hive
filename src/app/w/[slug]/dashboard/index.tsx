import { RepositoryCard } from "@/components/dashboard";
import { RecentTasksCard } from "@/components/dashboard/recent-tasks-card";
import { TestCoverageCard } from "@/components/insights/TestCoverageCard";
import { VMConfigSection } from "@/components/pool-status";
import { PageHeader } from "@/components/ui/page-header";
import { GraphComponent } from "../graph";

export function Dashboard() {
  return (
    <>
      <PageHeader title="Dashboard" description="Welcome to your development workspace." />

      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-3">
        <VMConfigSection />
        <RepositoryCard />
        <TestCoverageCard />
      </div>

      <RecentTasksCard />

      <GraphComponent />
    </>
  );
}