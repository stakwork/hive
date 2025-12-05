import { useDataStore } from '@/stores/useStores';
import type { JarvisResponse } from '@/types/jarvis';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Node } from '../../types';

export type GitSeeDataPhase = 'loading' | 'repo-ready' | 'directories-ready' | 'files-ready' | 'complete';


interface PollingConfig {
  initialInterval: number;
  maxInterval: number;
  maxAttempts: number;
  backoffMultiplier: number;
}

const DEFAULT_POLLING_CONFIG: PollingConfig = {
  initialInterval: 2000, // 2 seconds
  maxInterval: 10000, // 10 seconds max
  maxAttempts: 30, // Stop after 30 attempts (up to 5 minutes)
  backoffMultiplier: 1.2,
};

export const useGitSeeData = (workspaceId: string | undefined, config: Partial<PollingConfig> = {}) => {
  const pollingConfig = useMemo(() => ({ ...DEFAULT_POLLING_CONFIG, ...config }), [config]);
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

  // Request state tracking to prevent overlapping requests
  const [isRepoFetching, setIsRepoFetching] = useState(false);
  const [isDirectoryFetching, setIsDirectoryFetching] = useState(false);
  const [isFileFetching, setIsFileFetching] = useState(false);
  const [isFinalFetching, setIsFinalFetching] = useState(false);

  // Refs for polling control
  const repoPollingRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const directoryPollingRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const filePollingRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const finalPollingRef = useRef<NodeJS.Timeout | undefined>(undefined);
  const repoAttempts = useRef(0);
  const directoryAttempts = useRef(0);
  const fileAttempts = useRef(0);
  const finalAttempts = useRef(0);

  // Calculate polling interval with exponential backoff
  const calculateInterval = useCallback((attempts: number) => {
    const interval = pollingConfig.initialInterval * Math.pow(pollingConfig.backoffMultiplier, attempts);
    return Math.min(interval, pollingConfig.maxInterval);
  }, [pollingConfig]);

  // Fetch repository and contributor data with polling (Phase 1)
  const fetchRepoData = useCallback(async () => {
    if (!workspaceId || repoAttempts.current >= pollingConfig.maxAttempts || isRepoFetching) {
      console.log(`⏹️ Skipping repo fetch: workspaceId=${!!workspaceId}, attempts=${repoAttempts.current}/${pollingConfig.maxAttempts}, fetching=${isRepoFetching}`);
      return;
    }

    console.log(`🚀 Starting repo data fetch (attempt ${repoAttempts.current + 1}/${pollingConfig.maxAttempts})`);
    setIsRepoFetching(true);

    try {
      const params = new URLSearchParams({
        id: workspaceId,
        node_type: JSON.stringify(['GitHubRepo', 'Contributor', 'Stars']),
        endpoint: 'graph/search?limit=100&top_node_count=100&sort_by=date_added_to_graph'
      });

      const response = await fetch(`/api/swarm/jarvis/nodes?${params}`);
      const result = await response.json();

      repoAttempts.current++;
      setRetryCount(repoAttempts.current);

      if (result.success && result.data && result.data.nodes?.length > 0) {
        const repoNodes = result.data.nodes.filter((n: Node) =>
          ['GitHubRepo', 'Contributor', 'Stars'].includes(n.node_type)
        );

        console.log(`🔍 Found ${result.data.nodes.length} total nodes, ${repoNodes.length} repo-related nodes`);

        // More specific validation - at least check for GitHub repo
        const hasGitHubRepo = repoNodes.some((n: Node) => n.node_type === 'GitHubRepo');
        const hasContributors = repoNodes.some((n: Node) => n.node_type === 'Contributor');

        console.log(`📊 Repo validation: GitHubRepo=${hasGitHubRepo}, Contributors=${hasContributors}`);

        if (hasGitHubRepo && hasContributors) {
          // Save only the filtered nodes we need
          const filteredData = {
            ...result.data,
            nodes: repoNodes
          };

          setRepoData(filteredData);
          setPhase('repo-ready');
          setIsLoading(false);
          setIsRepoFetching(false);
          console.log('✅ Repo data loaded:', { totalNodes: repoNodes.length, types: repoNodes.map((n: Node) => n.node_type) });

          if (repoPollingRef.current) {
            clearTimeout(repoPollingRef.current);
          }
          return;
        }
      }

      // Continue polling if no data found
      console.log(`❌ No valid repo data found. Attempt ${repoAttempts.current}/${pollingConfig.maxAttempts}`);

      if (repoAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(repoAttempts.current);
        repoPollingRef.current = setTimeout(() => {
          setIsRepoFetching(false);
          fetchRepoData();
        }, nextInterval);
        console.log(`🔄 Retrying repo fetch in ${nextInterval}ms (attempt ${repoAttempts.current})`);
      } else {
        console.log('⚠️ Max repo fetch attempts reached, continuing without repo data');
        setPhase('repo-ready'); // Continue even without data
        setIsLoading(false);
        setIsRepoFetching(false);
      }
    } catch (err) {
      setError('Failed to fetch repository data');
      console.error('💥 Error fetching repo data:', err);
      repoAttempts.current++;

      console.log(`⚡ Repo fetch error. Attempt ${repoAttempts.current}/${pollingConfig.maxAttempts}`);

      if (repoAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(repoAttempts.current);
        repoPollingRef.current = setTimeout(() => {
          setIsRepoFetching(false);
          fetchRepoData();
        }, nextInterval);
        console.log(`🔄 Retrying repo fetch after error in ${nextInterval}ms`);
      } else {
        console.log('⚠️ Max repo error attempts reached, moving to repo-ready phase');
        setPhase('repo-ready');
        setIsLoading(false);
        setIsRepoFetching(false);
      }
    }
  }, [workspaceId, calculateInterval, pollingConfig.maxAttempts, isRepoFetching]);

  // Fetch directory data with polling (Phase 2)
  const fetchDirectoryData = useCallback(async () => {
    if (!workspaceId || directoryAttempts.current >= pollingConfig.maxAttempts || isDirectoryFetching) {
      console.log(`⏹️ Skipping directory fetch: workspaceId=${!!workspaceId}, attempts=${directoryAttempts.current}/${pollingConfig.maxAttempts}, fetching=${isDirectoryFetching}`);
      return;
    }

    console.log(`🚀 Starting directory data fetch (attempt ${directoryAttempts.current + 1}/${pollingConfig.maxAttempts})`);
    setIsDirectoryFetching(true);

    try {
      const params = new URLSearchParams({
        id: workspaceId,
        node_type: JSON.stringify(['Directory']),
        endpoint: 'graph/search?limit=200&sort_by=date_added_to_graph&depth=1'
      });

      const response = await fetch(`/api/swarm/jarvis/nodes?${params}`);
      const result = await response.json();

      directoryAttempts.current++;
      setRetryCount(directoryAttempts.current);

      if (result.success && result.data && result.data.nodes?.length > 0) {
        const directoryNodes = result.data.nodes.filter((n: Node) => n.node_type === 'Directory');

        if (directoryNodes.length > 0) {
          addNewNode({
            nodes: directoryNodes,
            edges: result.data.edges,
          });
          setDirectoryData(result.data);
          setPhase('directories-ready');
          setIsDirectoryFetching(false);
          console.log('✅ Directory data loaded:', result.data);

          if (directoryPollingRef.current) {
            clearTimeout(directoryPollingRef.current);
          }
          return;
        }
      }

      // Continue polling if no data found
      if (directoryAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(directoryAttempts.current);
        directoryPollingRef.current = setTimeout(() => {
          setIsDirectoryFetching(false);
          fetchDirectoryData();
        }, nextInterval);
        console.log(`🔄 Retrying directory fetch in ${nextInterval}ms (attempt ${directoryAttempts.current})`);
      } else {
        console.log('⚠️ Max directory fetch attempts reached, continuing without directory data');
        setPhase('directories-ready'); // Continue even without data
        setIsDirectoryFetching(false);
      }
    } catch (err) {
      console.error('Error fetching directory data:', err);
      directoryAttempts.current++;

      if (directoryAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(directoryAttempts.current);
        directoryPollingRef.current = setTimeout(() => {
          setIsDirectoryFetching(false);
          fetchDirectoryData();
        }, nextInterval);
      } else {
        setIsDirectoryFetching(false);
      }
    }
  }, [workspaceId, addNewNode, calculateInterval, pollingConfig.maxAttempts, isDirectoryFetching]);

  // Fetch file data with polling (Phase 3)
  const fetchFileData = useCallback(async () => {
    if (!workspaceId || fileAttempts.current >= pollingConfig.maxAttempts || isFileFetching) {
      console.log(`⏹️ Skipping file fetch: workspaceId=${!!workspaceId}, attempts=${fileAttempts.current}/${pollingConfig.maxAttempts}, fetching=${isFileFetching}`);
      return;
    }

    console.log(`🚀 Starting file data fetch (attempt ${fileAttempts.current + 1}/${pollingConfig.maxAttempts})`);
    setIsFileFetching(true);

    try {
      const params = new URLSearchParams({
        id: workspaceId,
        node_type: JSON.stringify(['File']),
        endpoint: 'graph/search?limit=200&sort_by=date_added_to_graph&depth=1'
      });

      const response = await fetch(`/api/swarm/jarvis/nodes?${params}`);
      const result = await response.json();

      fileAttempts.current++;
      setRetryCount(fileAttempts.current);

      if (result.success && result.data && result.data.nodes?.length > 0) {
        const fileNodes = result.data.nodes.filter((n: Node) => n.node_type === 'File');

        if (fileNodes.length > 0) {
          addNewNode({
            nodes: fileNodes,
            edges: result.data.edges,
          });
          setFileData(result.data);
          setPhase('files-ready');
          setIsFileFetching(false);
          console.log('✅ File data loaded:', result.data);

          if (filePollingRef.current) {
            clearTimeout(filePollingRef.current);
          }
          return;
        }
      }

      // Continue polling if no data found
      if (fileAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(fileAttempts.current);
        filePollingRef.current = setTimeout(() => {
          setIsFileFetching(false);
          fetchFileData();
        }, nextInterval);
        console.log(`🔄 Retrying file fetch in ${nextInterval}ms (attempt ${fileAttempts.current})`);
      } else {
        console.log('⚠️ Max file fetch attempts reached, continuing without file data');
        setPhase('files-ready'); // Continue even without data
        setIsFileFetching(false);
      }
    } catch (err) {
      console.error('Error fetching file data:', err);
      fileAttempts.current++;

      if (fileAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(fileAttempts.current);
        filePollingRef.current = setTimeout(() => {
          setIsFileFetching(false);
          fetchFileData();
        }, nextInterval);
      } else {
        setIsFileFetching(false);
      }
    }
  }, [workspaceId, addNewNode, calculateInterval, pollingConfig.maxAttempts, isFileFetching]);

  // Fetch final complete dataset (Phase 4)
  const fetchCompleteData = useCallback(async () => {
    if (!workspaceId || finalAttempts.current >= pollingConfig.maxAttempts) return;

    try {
      const response = await fetch(
        `/api/swarm/jarvis/nodes?id=${workspaceId}&endpoint=graph/search/latest?limit=5000&top_node_count=5000&sort_by=date_added_to_graph`
      );
      const result = await response.json();

      finalAttempts.current++;

      if (result.success && result.data && result.data.nodes?.length > 0) {
        addNewNode({
          nodes: result.data.nodes,
          edges: result.data.edges,
        });
        setPhase('complete');
        setIsOnboarding(false);
        console.log('✅ Complete dataset loaded:', result.data);

        if (finalPollingRef.current) {
          clearTimeout(finalPollingRef.current);
        }
        return;
      }

      // Continue polling if insufficient data
      if (finalAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(finalAttempts.current);
        finalPollingRef.current = setTimeout(fetchCompleteData, nextInterval);
        console.log(`🔄 Retrying complete data fetch in ${nextInterval}ms (attempt ${finalAttempts.current})`);
      } else {
        console.log('⚠️ Max complete data fetch attempts reached');
        setPhase('complete');
        setIsOnboarding(false);
      }
    } catch (err) {
      console.error('Error fetching complete data:', err);
      finalAttempts.current++;

      if (finalAttempts.current < pollingConfig.maxAttempts) {
        const nextInterval = calculateInterval(finalAttempts.current);
        finalPollingRef.current = setTimeout(fetchCompleteData, nextInterval);
      } else {
        setPhase('complete');
        setIsOnboarding(false);
      }
    }
  }, [workspaceId, addNewNode, calculateInterval, pollingConfig.maxAttempts, setIsOnboarding]);

  // Effect to start the data fetching sequence
  useEffect(() => {
    if (!workspaceId) return;

    console.log(`🔄 Starting GitSee data sequence for workspace: ${workspaceId}`);

    // Reset state when workspace changes
    setPhase('loading');
    setRepoData(null);
    setDirectoryData(null);
    setFileData(null);
    setError(null);
    setRetryCount(0);
    repoAttempts.current = 0;
    directoryAttempts.current = 0;
    fileAttempts.current = 0;
    finalAttempts.current = 0;
    setIsLoading(true);

    // Reset fetching states
    setIsRepoFetching(false);
    setIsDirectoryFetching(false);
    setIsFileFetching(false);
    setIsFinalFetching(false);

    console.log(`📊 Phase transition: loading → starting repo fetch`);

    // Start with repo data fetch
    fetchRepoData();

    return () => {
      if (repoPollingRef.current) clearTimeout(repoPollingRef.current);
      if (directoryPollingRef.current) clearTimeout(directoryPollingRef.current);
      if (filePollingRef.current) clearTimeout(filePollingRef.current);
      if (finalPollingRef.current) clearTimeout(finalPollingRef.current);
    };
  }, [workspaceId, fetchRepoData]);

  // Effect to trigger directory polling when repo data is ready
  useEffect(() => {
    if (phase === 'repo-ready' && !isRepoFetching) {
      console.log(`📊 Phase transition: repo-ready → starting directory fetch`);
      fetchDirectoryData();
    }
  }, [phase, fetchDirectoryData, isRepoFetching]);

  // Effect to trigger file polling when directory data is ready
  useEffect(() => {
    if (phase === 'directories-ready' && !isDirectoryFetching) {
      console.log(`📊 Phase transition: directories-ready → starting file fetch`);
      fetchFileData();
    }
  }, [phase, fetchFileData, isDirectoryFetching]);

  // Effect to trigger final data fetch when files are ready
  useEffect(() => {
    if (phase === 'files-ready' && !isFileFetching) {
      console.log(`📊 Phase transition: files-ready → starting complete data fetch`);
      // Add a small delay before final fetch to ensure files are processed
      const timer = setTimeout(fetchCompleteData, 2000);
      return () => clearTimeout(timer);
    }
  }, [phase, fetchCompleteData, isFileFetching]);

  return {
    phase,
    repoData,
    directoryData,
    fileData,
    isLoading,
    error,
    retryCount,
  };
};