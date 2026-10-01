import { useEffect, useState } from 'react';
import { useActivityStore } from '@/store/activityStore';
import { api } from '@/lib/api';

export const useMyActivity = () => {
  const [activities, setActivities] = useState([]);
  const { filterMilestones, search } = useActivityStore();

  useEffect(() => {
    const fetchActivities = async () => {
      const params = new URLSearchParams({
        filterMilestones: String(filterMilestones),
        search: search || '',
      });
      const response = await api.get(`/activity/my-activity?${params}`);
      setActivities(response.data);
    };

    fetchActivities();
  }, [filterMilestones, search]);

  return { activities };
};
