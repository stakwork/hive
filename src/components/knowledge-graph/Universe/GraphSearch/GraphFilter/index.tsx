import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useDataStore, useNodeTypes, useGraphStore } from "@/stores/useStores";
import { Filter } from "lucide-react";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { FilterGroup } from "./FilterGroup";

const followerRanges = [
  { label: "< 1000", value: "lt_1000" },
  { label: "1000 - 10,000", value: "1000_10000" },
  { label: "> 10,000", value: "gt_10000" },
];

const followerRangeTypes = followerRanges.map((range) => range.label);

const dateRanges = [
  { label: "Last Day", value: "last_day" },
  { label: "Last Week", value: "last_week" },
  { label: "Last Month", value: "last_month" },
  { label: "Last Year", value: "last_year" },
];

const dateRangeTypes = dateRanges.map((range) => range.label);

export const GraphFilter = () => {
  const [open, setOpen] = useState(false);
  const nodeTypes = useNodeTypes();
  const linkTypes = useDataStore((s) => s.linkTypes);
  const selectedNodeTypes = useGraphStore((s) => s.selectedNodeTypes);
  const selectedLinkTypes = useGraphStore((s) => s.selectedLinkTypes);
  const setSelectedNodeTypes = useGraphStore((s) => s.setSelectedNodeTypes);
  const setSelectedLinkTypes = useGraphStore((s) => s.setSelectedLinkTypes);
  const resetSelectedNodeTypes = useGraphStore((s) => s.resetSelectedNodeTypes);
  const resetSelectedLinkTypes = useGraphStore((s) => s.resetSelectedLinkTypes);
  const followersFilter = useGraphStore((s) => s.followersFilter);
  const setFollowersFilter = useGraphStore((s) => s.setFollowersFilter);
  const dateRangeFilter = useGraphStore((s) => s.dateRangeFilter);
  const setDateRangeFilter = useGraphStore((s) => s.setDateRangeFilter);

  const pathname = usePathname();
  const isTweetMindset = pathname.includes("/tweet/");

  const selectedFollowersType = followersFilter
    ? [followerRanges.find((range) => range.value === followersFilter)?.label || ""]
    : [];

  const selectedDateRangeType = dateRangeFilter
    ? [dateRanges.find((range) => range.value === dateRangeFilter)?.label || ""]
    : [];

  const getNodeTypeColor = (type: string) => {
    // Simple color mapping - can be enhanced with actual schema data
    const colors = ["#ff6b6b", "#4ecdc4", "#45b7d1", "#96ceb4", "#ffeaa7", "#dda0dd", "#98d8c8", "#f7dc6f"];
    const index = type.charCodeAt(0) % colors.length;
    return colors[index] || "#ffffff";
  };

  const handleFollowersTypeClick = (type: string) => {
    const selectedRange = followerRanges.find((range) => range.label === type);

    setFollowersFilter(selectedRange ? selectedRange.value : "");
  };

  const setSelectedDateRangeType = (type: string) => {
    const selectedRange = dateRanges.find((range) => range.label === type);

    setDateRangeFilter(selectedRange ? selectedRange.value : "");
  };

  const resetDateRangeFilter = () => {
    setDateRangeFilter("");
  };

  const resetFollowersFilter = () => {
    setFollowersFilter("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant={open ? "secondary" : "outline"}
          size="sm"
          className={`rounded-full transition-all ${
            open
              ? "bg-white text-gray-900 hover:bg-white/90"
              : "bg-gray-800 text-white hover:bg-white hover:text-gray-900"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-auto p-0 bg-gray-800 border-gray-700 rounded-xl mt-2 overflow-visible"
        sideOffset={8}
      >
        <div className="flex flex-row justify-center gap-3 relative h-full">
          <FilterGroup
            onResetClick={resetDateRangeFilter}
            onTypeClick={setSelectedDateRangeType}
            selectedTypes={selectedDateRangeType}
            title="Range"
            types={dateRangeTypes}
          />
          <FilterGroup
            getColor={getNodeTypeColor}
            onResetClick={resetSelectedNodeTypes}
            onTypeClick={setSelectedNodeTypes}
            selectedTypes={selectedNodeTypes}
            title="Nodes"
            types={nodeTypes}
          />
          <FilterGroup
            onResetClick={resetSelectedLinkTypes}
            onTypeClick={setSelectedLinkTypes}
            selectedTypes={selectedLinkTypes}
            title="Edges"
            types={linkTypes}
          />
          {isTweetMindset && (
            <FilterGroup
              onResetClick={resetFollowersFilter}
              onTypeClick={handleFollowersTypeClick}
              selectedTypes={selectedFollowersType}
              title="Followers"
              types={followerRangeTypes}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
