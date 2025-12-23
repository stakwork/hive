'use client';

import { useWorkspace } from '@/hooks/useWorkspace';
import { useDataStore } from '@/stores/useStores';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { CameraController } from './components/CameraController';
import { CentralRepository } from './components/CentralRepository';
import { ContributorLayer } from './components/ContributorLayer';
import { useGithubRepoData } from './hooks/useGithubRepoData';
import { useGitSeeDataSequence } from './hooks/useGitSeeDataSequence';

// --------------------------------------------------------
// CONFIGURATION VARIABLES
// --------------------------------------------------------

// Node distance and size controls
const NODE_CONFIG = {
  // Distance controls
  contributorDistance: 350,
  githubRepoDistance: 25,
  fileDistance: 55,
  statsDistance: 40,

  // Size controls
  centralNodeSize: 5.6,
  contributorNodeSize: 10,
  githubRepoNodeSize: 10,
  fileNodeSize: { width: 4, height: 2.5, depth: 0.3 },

  // Animation controls
  floatingAmplitude: 0.15,
  rotationSpeed: 0.002,

  // Visual adjustments
  centralNodeScale: 2.0,
  lineOpacity: {
    contributors: 0.25,
    githubRepos: 0.3,
    files: 0.2,
    stats: 0.9
  },

  // Enable/disable node types
  showStats: false,
  showFiles: false
};

// Camera and timing configuration
const CAMERA_CONFIG = {
  // Camera movement timing
  initialFocusDistance: NODE_CONFIG.contributorDistance * 2, // Initial camera distance from scene
  maxZoomOutDistance: 2500, // Maximum distance camera can zoom out to

  // Camera animation parameters
  orbitSpeed: 0.01, // How fast the camera orbits
  radiusGrowthExponent: 1.6, // Controls acceleration curve (higher = faster acceleration)
  radiusGrowthMultiplier: 25, // Overall scale of zoom out
  heightVariationAmplitude: 50, // Up/down movement amplitude
  heightVariationSpeed: 0.5 // Speed of up/down movement
};

const gitseePosition = new THREE.Vector3(0, 0, 0);

export function RepositoryScene() {
  const { workspace } = useWorkspace();
  const nodeTypes = useDataStore((s) => s.nodeTypes);

  // Use both hooks for hybrid data approach
  const repositoryUrl = workspace?.repositories?.[0]?.repositoryUrl;

  // GitHub repository data (contributors, stars, repo info)
  const {
    repositoryData,
    isLoading: githubLoading,
    error: githubError,
  } = useGithubRepoData(workspace?.id, repositoryUrl);

  // Jarvis code data (functions, files, directories) - only start after GitHub data is ready
  const githubDataReady = !!repositoryData && !githubLoading && !githubError;
  const {
    phase,
    directoryData,
    fileData,
    isLoading: jarvisLoading,
    error: jarvisError,
  } = useGitSeeDataSequence(workspace?.id, githubDataReady);

  // Animation timing
  const startTimeRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const currentGroupPosition = useRef(new THREE.Vector3(0, 0, 0));
  const targetGroupPosition = useRef(new THREE.Vector3(0, 0, 0));

  console.log('repositoryData', repositoryData);
  console.log('jarvis phase', phase);

  // Combine loading states and errors
  const isLoading = githubLoading || jarvisLoading;
  const error = githubError || jarvisError;

  // Component visibility states based on data phase
  const showCentralRepo = true; // Always show central repo with default logo
  const showContributors = (repositoryData?.contributors?.length ?? 0) > 0;
  const showDirectories = ['directories-ready', 'files-ready', 'complete'].includes(phase);
  const showFiles = ['files-ready', 'complete'].includes(phase);

  // Log directory and file data when ready
  if (showDirectories && directoryData) {
    console.log('✅ Directory data ready:', directoryData.nodes?.length, 'directories');
  }
  if (showFiles && fileData) {
    console.log('✅ File data ready:', fileData.nodes?.length, 'files');
  }

  // Group position animation
  useFrame((state) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }

    // Smooth group position animation
    targetGroupPosition.current.set(0, -nodeTypes.length * 500 / 2, 0);
    currentGroupPosition.current.lerp(targetGroupPosition.current, 0.02);

    if (groupRef.current) {
      groupRef.current.position.copy(currentGroupPosition.current);
    }
  });

  // Generate repository label
  const repoLabel = useMemo(() => {
    if (repositoryData?.name) {
      return repositoryData.name;
    }

    if (workspace?.repositories?.[0]?.name) {
      return workspace.repositories[0].name;
    }

    return 'Repository';
  }, [repositoryData, workspace]);

  // Show error state
  if (error) {
    console.error('GitSee Scene Error:', error);
  }

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* Camera Controller - handles all camera animations based on data state */}
      <CameraController
        dataPhase={phase}
        gitseePosition={gitseePosition}
        cameraConfig={CAMERA_CONFIG}
      />

      {/* Central Repository Node */}
      <CentralRepository
        repositoryData={repositoryData}
        repoLabel={repoLabel}
        githubRepoNodeSize={NODE_CONFIG.githubRepoNodeSize}
        centralNodeScale={NODE_CONFIG.centralNodeScale}
        elapsed={startTimeRef.current ? performance.now() / 1000 - startTimeRef.current : 0}
        isVisible={showCentralRepo}
        isLoading={isLoading}
      />

      {/* Contributors Layer */}
      <ContributorLayer
        repositoryData={repositoryData}
        contributorDistance={NODE_CONFIG.contributorDistance}
        contributorNodeSize={NODE_CONFIG.contributorNodeSize}
        floatingAmplitude={NODE_CONFIG.floatingAmplitude}
        lineOpacity={NODE_CONFIG.lineOpacity.contributors}
        isVisible={showContributors}
        startTime={startTimeRef.current}
      />


      {/* LIGHTING */}
      <ambientLight intensity={0.45} />

      <directionalLight
        color="white"
        intensity={5}
        position={[
          gitseePosition.x + 10,
          gitseePosition.y - 10,
          gitseePosition.z + 20,
        ]}
      />

      <directionalLight
        color="white"
        intensity={5}
        position={[
          gitseePosition.x - 10,
          gitseePosition.y + 10,
          gitseePosition.z + 20,
        ]}
      />

      <spotLight
        position={[gitseePosition.x + 10, gitseePosition.y + 5, gitseePosition.z]}
        angle={0.15}
        color="white"
        penumbra={1}
        intensity={5}
      />

      <pointLight
        intensity={500}
        color="white"
        position={[gitseePosition.x, gitseePosition.y, gitseePosition.z]}
      />

      {/* Debug info and visual feedback */}
    </group>
  );
}
