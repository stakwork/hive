"use client";

import { GraphComponent } from "@/components/knowledge-graph";
// import { useGraphPolling } from "@/hooks/useGraphPolling";

export function Dashboard() {
  // const { isPolling, isPollingActive } = useGraphPolling({
  //   enabled: true,
  //   interval: 5000
  // });

  // console.log("isPolling", isPolling);
  // console.log("isPollingActive", isPollingActive);
  return (
    <div className="flex flex-col flex-1 h-full">
      <div className="flex-1 min-h-0">
        <GraphComponent
          endpoint={`graph/search/latest?limit=1000&top_node_count=500`}
          enableRotation={true}
          enablePolling={true}
          height="h-full"
          width="w-full"
          showWidgets={true}
        />
      </div>
    </div>
  );
}
