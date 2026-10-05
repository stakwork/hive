import React from 'react';
import { useActivityStore } from '@/store/activityStore';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

export const ActivityFilters = () => {
  const { setFilterMilestones, filterMilestones } = useActivityStore();

  return (
    <div className="flex items-center space-x-2 p-4">
      <Switch 
        id="milestone-filter" 
        checked={filterMilestones} 
        onCheckedChange={setFilterMilestones} 
      />
      <Label htmlFor="milestone-filter">Show only milestones</Label>
    </div>
  );
};
