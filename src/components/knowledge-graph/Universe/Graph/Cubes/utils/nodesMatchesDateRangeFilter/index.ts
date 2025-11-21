import { NodeExtended } from "@Universe/types";

export const nodesMatchesDateRangeFilter = (targetNode: NodeExtended, value: string | null): boolean => {
  if (!value || targetNode.date_added_to_graph === undefined) {
    return false;
  }

  // Convert Unix timestamp to Date object
  const nodeDate = new Date(targetNode.date_added_to_graph * 1000);
  const now = new Date();

  switch (value) {
    case "last_day": {
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      return nodeDate > oneDayAgo;
    }
    case "last_week": {
      const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      return nodeDate > oneWeekAgo;
    }
    case "last_month": {
      const oneMonthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      return nodeDate > oneMonthAgo;
    }
    case "last_year": {
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      return nodeDate > oneYearAgo;
    }
    default:
      return true;
  }
};
