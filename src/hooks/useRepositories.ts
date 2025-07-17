import { useState } from "react";
import { Repository } from "@/types/wizard";
import { mockRepositories } from "@/data/mockRepositories";

// Removed username from props
interface UseRepositoriesReturn {
  repositories: Repository[];
  loading: boolean;
  fetchRepositories: () => Promise<void>;
}

export function useRepositories(): UseRepositoriesReturn {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRepositories = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/github/repositories");
      if (response.ok) {
        const data = await response.json();
        setRepositories(data.repositories || []);
      } else {
        // Fallback to mock data for testing
        setRepositories(mockRepositories);
      }
    } catch (error) {
      console.error("Failed to fetch repositories:", error);
      // Fallback to mock data for testing
      setRepositories(mockRepositories);
    } finally {
      setLoading(false);
    }
  };

  return {
    repositories,
    loading,
    fetchRepositories,
  };
} 