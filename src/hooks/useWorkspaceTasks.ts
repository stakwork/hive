import { useState, useEffect, useCallback } from 'react';
import { Task } from '@/types/task';

interface PaginationState {
  page: number;
  hasMore: boolean;
}

interface UseWorkspaceTasksReturn {
  tasks: Task[];
  loading: boolean;
  pagination: PaginationState;
  loadMore: () => void;
  refresh: () => void;
}

export const useWorkspaceTasks = (workspaceId: string): UseWorkspaceTasksReturn => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<PaginationState>({
    page: 1,
    hasMore: true,
  });
  const [persistedItemCount, setPersistedItemCount] = useState<number>(5);
  const [isInitialized, setIsInitialized] = useState(false);

  // Load persisted item count from localStorage on mount
  useEffect(() => {
    const savedItemCount = localStorage.getItem('task_display_count');
    if (savedItemCount) {
      const count = parseInt(savedItemCount, 10);
      if (count && count > 0 && count <= 500) { // Reasonable max limit
        setPersistedItemCount(count);
      }
    }
    setIsInitialized(true);
  }, []);

  // Save item count to localStorage whenever it changes
  const updatePersistedItemCount = useCallback((count: number) => {
    setPersistedItemCount(count);
    localStorage.setItem('task_display_count', count.toString());
  }, []);

  const fetchTasks = useCallback(async (page: number, includeLatestMessage: boolean = false) => {
    if (!workspaceId) return null;

    try {
      // Assuming there's an API call to fetch tasks
      const response = await fetch(`/api/workspaces/${workspaceId}/tasks?page=${page}&includeLatestMessage=${includeLatestMessage}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch tasks');
      }

      const data = await response.json();
      return {
        tasks: data.tasks as Task[],
        hasMore: data.hasMore as boolean,
      };
    } catch (error) {
      console.error('Error fetching tasks:', error);
      return null;
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId || !isInitialized) return;

    const loadInitialTasks = async () => {
      setLoading(true);
      try {
        // Calculate how many pages we need to restore the persisted item count
        const itemsPerPage = 5;
        const pagesToLoad = Math.ceil(persistedItemCount / itemsPerPage);
        
        let allTasks: Task[] = [];
        let currentPage = 1;
        let hasMore = true;

        // Load pages sequentially until we have the persisted item count
        while (currentPage <= pagesToLoad && hasMore) {
          const result = await fetchTasks(currentPage, currentPage === 1);
          if (result) {
            if (currentPage === 1) {
              allTasks = result.tasks;
            } else {
              allTasks = [...allTasks, ...result.tasks];
            }
            hasMore = result.hasMore;
            currentPage++;
          } else {
            break;
          }
        }

        setTasks(allTasks);
        setPagination({
          page: currentPage - 1,
          hasMore: hasMore,
        });
      } catch (error) {
        console.error('Error loading tasks:', error);
      } finally {
        setLoading(false);
      }
    };

    loadInitialTasks();
  }, [workspaceId, fetchTasks, persistedItemCount, isInitialized]);

  const loadMore = useCallback(async () => {
    if (loading || !pagination.hasMore) return;

    setLoading(true);
    try {
      const result = await fetchTasks(pagination.page + 1);
      if (result) {
        setTasks(prev => [...prev, ...result.tasks]);
        setPagination({
          page: pagination.page + 1,
          hasMore: result.hasMore,
        });
        
        // Update persisted item count to reflect the new total
        const newItemCount = persistedItemCount + 5; // Adding 5 more items
        updatePersistedItemCount(newItemCount);
      }
    } catch (error) {
      console.error('Error loading more tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [loading, pagination, fetchTasks, persistedItemCount, updatePersistedItemCount]);

  const refresh = useCallback(async () => {
    if (!workspaceId) return;

    setLoading(true);
    try {
      const result = await fetchTasks(1, true);
      if (result) {
        setTasks(result.tasks);
        setPagination({
          page: 1,
          hasMore: result.hasMore,
        });
        // Reset persisted item count to default on refresh
        updatePersistedItemCount(5);
      }
    } catch (error) {
      console.error('Error refreshing tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, fetchTasks, updatePersistedItemCount]);

  return { tasks, loading, pagination, loadMore, refresh };
};