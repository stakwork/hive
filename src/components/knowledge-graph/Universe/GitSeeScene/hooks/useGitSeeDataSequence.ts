import { useDataStore } from '@/stores/useStores';
import type { JarvisNode, JarvisResponse } from '@/types/jarvis';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Link, Node } from '../../types';

export type GitSeeDataPhase = 'loading' | 'repo-ready' | 'directories-ready' | 'files-ready' | 'complete';

interface UseGitSeeDataSequenceReturn {
  phase: GitSeeDataPhase;
  repoData: JarvisResponse | null;
  directoryData: JarvisResponse | null;
  fileData: JarvisResponse | null;
  isLoading: boolean;
  error: string | null;
  retryCount: number;
  reset: () => void;
}

const MAX_RETRIES = 15;
const RETRY_DELAY = 2000;
const BASIC_NODE_TYPES = new Set(['Directory', 'File', 'GitHubRepo', 'Contributor', 'Stars', 'Issues', 'Age', 'Commits']);

// Helper function to wait/delay
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry logic
const fetchWithRetry = async (url: string, maxRetries: number = MAX_RETRIES): Promise<JarvisResponse> => {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      console.log(`🚀 Fetching data (attempt ${attempt + 1}/${maxRetries}): ${url}`);

      const response = await fetch(url);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      if (result.success) {
        if (!result.data?.nodes?.length) {
          throw new Error('No nodes found in response');
        }
        return result.data;
      } else {
        throw new Error(result.error || 'API returned success: false');
      }
    } catch (error) {
      lastError = error as Error;
      console.warn(`❌ Attempt ${attempt + 1} failed:`, error);

      // Wait before retry (except on last attempt)
      if (attempt < maxRetries - 1) {
        await wait(RETRY_DELAY);
      }
    }
  }

  throw lastError || new Error('All retry attempts failed');
};

// Validate repo data - require both GitHubRepo and Contributors
const validateRepoData = (data: JarvisResponse): boolean => {
  if (!data.nodes?.length) return false;

  const repoNodes = data.nodes.filter((n: JarvisNode) =>
    ['GitHubRepo', 'Contributor', 'Stars'].includes(n.node_type)
  );

  const hasGitHubRepo = repoNodes.some((n: JarvisNode) => n.node_type === 'GitHubRepo');
  const hasContributors = repoNodes.some((n: JarvisNode) => n.node_type === 'Contributor');

  console.log(`📊 Repo validation: GitHubRepo=${hasGitHubRepo}, Contributors=${hasContributors}`);
  return hasGitHubRepo || hasContributors;
};

export const useGitSeeDataSequence = (workspaceId: string | undefined): UseGitSeeDataSequenceReturn => {
  const addNewNode = useDataStore((s) => s.addNewNode);
  const setIsOnboarding = useDataStore((s) => s.setIsOnboarding);

  // State
  const [phase, setPhase] = useState<GitSeeDataPhase>('loading');
  const [repoData, setRepoData] = useState<JarvisResponse | null>(null);
  const [directoryData, setDirectoryData] = useState<JarvisResponse | null>(null);
  const [fileData, setFileData] = useState<JarvisResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // Ref to track if sequence is running to prevent multiple concurrent executions
  const sequenceRunningRef = useRef(false);
  const latestFetchRunningRef = useRef(false);
  const latestFetchCompleteRef = useRef(false);
  const onboardingClearedRef = useRef(false);
  const latestFetchStopRef = useRef(false);

  const clearOnboarding = useCallback(() => {
    if (onboardingClearedRef.current) return;
    onboardingClearedRef.current = true;
    setIsOnboarding(false);
  }, [setIsOnboarding]);

  const hasAdditionalNodes = useCallback((nodes: JarvisNode[] | undefined) => {
    if (!nodes?.length) return false;
    return nodes.some((n) => !BASIC_NODE_TYPES.has(n.node_type));
  }, []);

  const startLatestFetch = useCallback(async (workspaceId: string) => {
    if (latestFetchRunningRef.current || latestFetchCompleteRef.current) return;
    latestFetchRunningRef.current = true;
    latestFetchStopRef.current = false;

    let attempt = 0;
    try {
      // keep polling until we actually get data
      while (!latestFetchCompleteRef.current && !latestFetchStopRef.current) {
        attempt += 1;
        try {
          const latestData = await fetchWithRetry(
            `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=graph/search/latest?limit=5000&top_node_count=5000&sort_by=date_added_to_graph`,
            1 // retry handled by loop
          );

          if (latestData.nodes?.length) {
            const hasFunctionOrVar = latestData.nodes.some(
              (n) => n.node_type === 'Function' || n.node_type === 'Var'
            );

            if (hasAdditionalNodes(latestData.nodes) || hasFunctionOrVar) {
              addNewNode({
                nodes: (latestData.nodes || []) as Node[],
                edges: (latestData.edges || []) as Link<string>[],
              });
              clearOnboarding();
              latestFetchCompleteRef.current = true;
              setPhase('complete');
              console.log(`✅ Latest data loaded on attempt ${attempt} (nodes: ${latestData.nodes.length})`);
              break;
            }

            console.log(`ℹ️ Latest data lacks additional nodes on attempt ${attempt}, retrying...`);
            await wait(RETRY_DELAY);
            continue;
          }

          console.log(`ℹ️ Latest data empty on attempt ${attempt}, retrying...`);
        } catch (err) {
          console.warn(`⚠️ Latest data fetch failed (attempt ${attempt}):`, err);
        }

        await wait(RETRY_DELAY);
      }
    } finally {
      latestFetchRunningRef.current = false;
    }
  }, [addNewNode, hasAdditionalNodes, setPhase, clearOnboarding]);

  // Main sequence function
  const runSequence = useCallback(async (workspaceId: string) => {
    if (sequenceRunningRef.current) {
      console.log('🛑 Sequence already running, skipping');
      return;
    }

    sequenceRunningRef.current = true;
    setIsLoading(true);
    setError(null);
    setRetryCount(0);

    try {
      console.log(`🔄 Starting GitSee data sequence for workspace: ${workspaceId}`);

      // Step 1: Fetch repository data
      setPhase('loading');
      console.log('📊 Phase: loading → fetching repo data');

      try {
        const repoResult = await fetchWithRetry(
          `/api/swarm/jarvis/nodes?id=${workspaceId}&node_type=${JSON.stringify(['GitHubRepo', 'Contributor', 'Stars'])}&endpoint=graph/search?limit=100&top_node_count=100&sort_by=date_added_to_graph`
        );

        if (validateRepoData(repoResult)) {
          const repoNodes = repoResult.nodes?.filter((n: JarvisNode) =>
            ['GitHubRepo', 'Contributor', 'Stars'].includes(n.node_type)
          ) || [];

          if (repoNodes.length > 0) {
            const filteredRepoData = { ...repoResult, nodes: repoNodes };
            setRepoData(filteredRepoData);
            setPhase('repo-ready');
            console.log(`✅ Added ${repoNodes.length} repo nodes to store`);
          }
        }
      } catch (repoError) {
        console.warn('⚠️ Repo data fetch failed, continuing sequence:', repoError);
        setRetryCount(prev => prev + MAX_RETRIES);
      }


      // Step 2: Fetch directory data
      try {
        const directoryResult = await fetchWithRetry(
          `/api/swarm/jarvis/nodes?id=${workspaceId}&node_type=${JSON.stringify(['Directory'])}&endpoint=graph/search?limit=200&sort_by=date_added_to_graph&depth=1`
        );

        const directoryNodes = directoryResult.nodes?.filter((n: JarvisNode) => n.node_type === 'Directory') || [];

        if (directoryNodes.length > 0) {
          const filteredDirectoryData = { ...directoryResult, nodes: directoryNodes };
          setDirectoryData(filteredDirectoryData);
          addNewNode({
            nodes: directoryNodes as Node[],
            edges: (directoryResult.edges || []) as Link<string>[],
          });
          setPhase((prev) => (prev === 'complete' ? prev : 'directories-ready'));
          console.log(`✅ Added ${directoryNodes.length} directory nodes to store`);
        }
      } catch (dirError) {
        console.warn('⚠️ Directory data fetch failed, continuing sequence:', dirError);
        setRetryCount(prev => prev + MAX_RETRIES);
      }


      // Step 3: Fetch file data
      try {
        const fileResult = await fetchWithRetry(
          `/api/swarm/jarvis/nodes?id=${workspaceId}&node_type=${JSON.stringify(['File'])}&endpoint=graph/search?limit=200&sort_by=date_added_to_graph&depth=1`
        );

        const fileNodes = fileResult.nodes?.filter((n: JarvisNode) => n.node_type === 'File') || [];

        if (fileNodes.length > 0) {
          const filteredFileData = { ...fileResult, nodes: fileNodes };
          setFileData(filteredFileData);
          addNewNode({
            nodes: fileNodes as Node[],
            edges: (fileResult.edges || []) as Link<string>[],
          });
          console.log(`✅ Added ${fileNodes.length} file nodes to store`);
          setPhase((prev) => (prev === 'complete' ? prev : 'files-ready'));
        }
      } catch (fileError) {
        console.warn('⚠️ File data fetch failed, continuing sequence:', fileError);
        setRetryCount(prev => prev + MAX_RETRIES);
      }


    } catch (error) {
      console.error('💥 Sequence failed:', error);
      setError(`Failed to load GitSee data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsLoading(false);
      sequenceRunningRef.current = false;
    }
  }, [addNewNode]);

  // Start sequence when workspace changes
  useEffect(() => {
    if (workspaceId) {
      runSequence(workspaceId);
    }
  }, [workspaceId, runSequence]);

  useEffect(() => {
    if (workspaceId && phase === 'repo-ready') {
      startLatestFetch(workspaceId);
    }
  }, [workspaceId, phase, startLatestFetch]);

  // Reset function
  const reset = useCallback(() => {
    console.log('🔄 Resetting GitSee data sequence');
    sequenceRunningRef.current = false;
    latestFetchRunningRef.current = false;
    latestFetchCompleteRef.current = false;
    latestFetchStopRef.current = true;
    onboardingClearedRef.current = false;
    setPhase('loading');
    setRepoData(null);
    setDirectoryData(null);
    setFileData(null);
    setIsLoading(false);
    setError(null);
    setRetryCount(0);
  }, []);

  return {
    phase,
    repoData,
    directoryData,
    fileData,
    isLoading,
    error,
    retryCount,
    reset,
  };
};
