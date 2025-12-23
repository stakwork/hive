import { RepositoryData } from '@/types/github';
import { useCallback, useEffect, useState } from 'react';

export interface GitHubRepoState {
  repositoryData: RepositoryData | null;
  isLoading: boolean;
  error: string | null;
  phase: 'loading' | 'loaded' | 'error';
}

export const useGithubRepoData = (workspaceId: string | undefined, repositoryUrl?: string): GitHubRepoState => {
  const [repositoryData, setRepositoryData] = useState<RepositoryData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<'loading' | 'loaded' | 'error'>('loading');

  const fetchRepositoryData = useCallback(async () => {
    if (!workspaceId || !repositoryUrl) return;

    setIsLoading(true);
    setError(null);
    setPhase('loading');

    try {
      console.log('🚀 Fetching GitHub repository data:', repositoryUrl);

      const response = await fetch(`/api/github/repository/data?repoUrl=${encodeURIComponent(repositoryUrl)}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}`);
      }

      if (result.data) {
        setRepositoryData(result.data);
        setPhase('loaded');
        console.log('✅ GitHub repository data loaded:', result.data);
      } else {
        throw new Error(result.error || 'Failed to fetch repository data');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ Failed to fetch GitHub repository data:', errorMessage);
      setError(errorMessage);
      setPhase('error');
    } finally {
      setIsLoading(false);
    }
  }, [workspaceId, repositoryUrl]);

  useEffect(() => {
    fetchRepositoryData();
  }, [fetchRepositoryData]);

  return {
    repositoryData,
    isLoading,
    error,
    phase,
  };
};