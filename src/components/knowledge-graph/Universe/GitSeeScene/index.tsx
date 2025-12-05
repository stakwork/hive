'use client';

import { useWorkspace } from '@/hooks/useWorkspace';
import { useControlStore } from '@/stores/useControlStore';
import { useDataStore } from '@/stores/useStores';
import type { JarvisResponse } from '@/types/jarvis';
import { Billboard, Html, Text } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Node } from '../types';

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
  // Data loading timing (in seconds)
  contributorsShowDelay: 2.5, // When contributor nodes become visible
  cameraAnimationStartDelay: 40.0, // How long to wait before any camera movement starts
  orbitStartDelay: 2.0, // Additional delay after animation starts to begin orbiting
  distancingDelay: 2.0, // Additional delay after orbiting starts to begin zooming out
  filesShowDelay: 3.0, // When file nodes become visible (visual rendering delay)
  directoriesLoadDelay: 80.0, // When directories load
  filesLoadDelay: 100, // When files load (2 seconds after directories)

  // Node visibility timing (in seconds)

  // Camera movement timing
  initialFocusDistance: NODE_CONFIG.contributorDistance * 2, // Initial camera distance from scene
  maxZoomOutDistance: 2500, // Maximum distance camera can zoom out to

  // Camera animation parameters
  orbitSpeed: 0.01, // How fast the camera orbits
  baseRadius: NODE_CONFIG.contributorDistance * 2, // Starting radius for orbit
  radiusGrowthExponent: 1.6, // Controls acceleration curve (higher = faster acceleration)
  radiusGrowthMultiplier: 25, // Overall scale of zoom out
  heightVariationAmplitude: 50, // Up/down movement amplitude
  heightVariationSpeed: 0.5 // Speed of up/down movement
};

// --------------------------------------------------------
// GITHUB ICON TEXTURE
// --------------------------------------------------------

function createGitHubIconTexture(base64Icon?: string) {
  // SSR-safe fallback
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex;
  }

  const loader = new THREE.TextureLoader();

  // Use base64 icon if available, otherwise fallback to default
  const imageSource = base64Icon ? base64Icon : '/gitimage.png';

  console.log('imageSource', imageSource);

  const tex = loader.load(
    imageSource,
    (texture) => {
      texture.anisotropy = 8;
      texture.flipY = false;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.needsUpdate = true;
    },
    undefined,
    (error) => {
      console.warn('Failed to load repository icon, using fallback:', error);
    }
  );

  return tex;
}

// --------------------------------------------------------
// AVATAR TEXTURE CACHE
// --------------------------------------------------------

const avatarCache = new Map<string, THREE.Texture>();
const repoIconCache = new Map<string, THREE.Texture>();

function getAvatarTexture(color: number, avatarUrl?: string) {
  const key = avatarUrl || `color-${color}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;

  // SSR-safe fallback
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    avatarCache.set(key, tex);
    return tex;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  avatarCache.set(key, tex);

  // fallback background
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);
  tex.needsUpdate = true;

  if (avatarUrl) {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    loader.load(
      avatarUrl,
      (loaded) => {
        ctx.clearRect(0, 0, size, size);
        ctx.save();
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(loaded.image, 0, 0, size, size);
        ctx.restore();
        tex.needsUpdate = true;
      },
      undefined,
      () => {
        console.warn('Avatar load failed', avatarUrl);
      }
    );
  }

  return tex;
}

const gitseePosition = new THREE.Vector3(0, 0, 0);


export function RepositoryScene() {
  const repoRef = useRef<THREE.Group>(null);
  const contributorRefs = useRef<(THREE.Mesh | null)[]>([]);
  const githubRepoRefs = useRef<(THREE.Mesh | null)[]>([]);
  const fileRefs = useRef<(THREE.Mesh | null)[]>([]);
  const directoryRefs = useRef<(THREE.Mesh | null)[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const groupRef = useRef<THREE.Group>(null);
  const currentGroupPosition = useRef(new THREE.Vector3(0, 0, 0));
  const targetGroupPosition = useRef(new THREE.Vector3(0, 0, 0));
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef)
  const addNewNode = useDataStore((s) => s.addNewNode);

  const setIsOnboarding = useDataStore((s) => s.setIsOnboarding);

  // lighting refs
  const lightRefTopLeft = useRef<THREE.DirectionalLight>(null);
  const lightRefTopRight = useRef<THREE.DirectionalLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);

  const [showOuterNodes, setShowOuterNodes] = useState(false);
  const [hasCameraFocused, setHasCameraFocused] = useState(false);
  const [cameraOrbitActive, setCameraOrbitActive] = useState(false);
  const [cameraDistancingActive, setCameraDistancingActive] = useState(false);
  const [showContributors, setShowContributors] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const nodeTypes = useDataStore((s) => s.nodeTypes);
  const { workspace } = useWorkspace();
  const { camera } = useThree();

  // State for jarvis data
  const [jarvisData, setJarvisData] = useState<JarvisResponse | null>(null);
  const [directoriesData, setDirectoriesData] = useState<JarvisResponse | null>(null);

  // position GitSee vs main graph

  useEffect(() => {
    if (!workspace?.id) return;

    const fetchNodes = async () => {
      try {
        const params = new URLSearchParams({
          id: workspace.id,
          node_type: JSON.stringify(["GitHubRepo", "Contributor", "Stars"]),
          endpoint: 'graph/search?limit=100&top_node_count=100&sort_by=date_added_to_graph'
        });

        const response = await fetch(`/api/swarm/jarvis/nodes?${params}`);
        const result = await response.json();

        console.log('result-here', result);

        if (result.success && result.data) {
          setJarvisData(result.data);
          console.log('Jarvis nodes data:', result.data);
        }
      } catch (error) {
        console.error('Error fetching jarvis nodes:', error);
      }
    };

    fetchNodes();

    // Delayed fetch for directories
    const directoriesTimeoutId = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          id: workspace.id,
          node_type: JSON.stringify(["Directory"]),
          endpoint: 'graph/search?limit=200&sort_by=date_added_to_graph&depth=1'
        });

        const response = await fetch(`/api/swarm/jarvis/nodes?${params}`);
        const result = await response.json();

        if (result.success && result.data) {
          addNewNode({
            nodes: result.data.nodes.filter((n: Node) => n.node_type === 'Directory'),
            edges: result.data.edges,
          });
          setDirectoriesData(result.data);
          console.log('Directories data:', result.data);
        }
      } catch (error) {
        console.error('Error fetching directories:', error);
      }
    }, CAMERA_CONFIG.directoriesLoadDelay * 1000);

    // Delayed fetch for files
    const filesTimeoutId = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          id: workspace.id,
          node_type: JSON.stringify(["File"]),
          endpoint: 'graph/search?limit=200&sort_by=date_added_to_graph&depth=1'
        });

        const response = await fetch(`/api/swarm/jarvis/nodes?${params}`);
        const result = await response.json();

        if (result.success && result.data) {
          addNewNode({
            nodes: result.data.nodes.filter((n: Node) => n.node_type === 'File'),
            edges: result.data.edges,
          });

          // Update directoriesData to include both directories and files for rendering
          setDirectoriesData(prev => ({
            ...result.data,
            nodes: [...(prev?.nodes || []), ...result.data.nodes]
          }));
          console.log('Files data:', result.data);
        }
      } catch (error) {
        console.error('Error fetching files:', error);
      }
    }, CAMERA_CONFIG.filesLoadDelay * 1000);

    const latestTimeoutId = setTimeout(async () => {
      try {
        const response = await fetch(`/api/swarm/jarvis/nodes?id=${workspace.id}&endpoint=graph/search/latest?limit=5000&top_node_count=5000&sort_by=date_added_to_graph`);
        const result = await response.json();

        if (result.success && result.data) {
          addNewNode({
            nodes: result.data.nodes,
            edges: result.data.edges,
          });
        }
      } catch (error) {
        console.error('Error fetching latest nodes:', error);
      } finally {
        setIsOnboarding(false);
      }
    }, (CAMERA_CONFIG.filesLoadDelay + 10) * 1000);

    return () => {
      clearTimeout(directoriesTimeoutId);
      clearTimeout(filesTimeoutId);
      clearTimeout(latestTimeoutId);
    };
  }, [workspace?.id, addNewNode, setIsOnboarding]);

  // Focus camera on GitSee scene when data loads (with delay for timing)
  useEffect(() => {
    if (jarvisData?.nodes && !hasCameraFocused && cameraControlsRef) {

      const targetPosition = new THREE.Vector3(
        gitseePosition.x,
        gitseePosition.y,
        gitseePosition.z + CAMERA_CONFIG.initialFocusDistance
      );

      cameraControlsRef?.setLookAt(targetPosition.x, targetPosition.y, targetPosition.z, 0, 0, 0, false);
      setHasCameraFocused(true);

      // Start orbital animation after delay to let users see initial nodes
      setTimeout(() => {
        setCameraOrbitActive(true);
      }, (CAMERA_CONFIG.cameraAnimationStartDelay + CAMERA_CONFIG.orbitStartDelay) * 1000);

      // Start distancing (zoom out) after additional delay
      setTimeout(() => {
        setCameraDistancingActive(true);
      }, (CAMERA_CONFIG.cameraAnimationStartDelay + CAMERA_CONFIG.distancingDelay) * 1000);

      // Show contributors after delay
      setTimeout(() => {
        setShowContributors(true);
      }, CAMERA_CONFIG.contributorsShowDelay * 1000);

      // Show files after delay
      setTimeout(() => {
        setShowFiles(true);
      }, CAMERA_CONFIG.filesShowDelay * 1000);
    }
  }, [jarvisData, hasCameraFocused, gitseePosition, camera, cameraControlsRef]);

  // --------------------------------------------------------
  // DATA PROCESSING
  // --------------------------------------------------------

  const contributorData = useMemo(() => {
    if (!jarvisData?.nodes) return [];

    const nodes = jarvisData.nodes
      .filter((n) => n.node_type === 'Contributor')
      .slice(0, 12);

    const radius = NODE_CONFIG.contributorDistance;
    const count = nodes.length || 1;

    return nodes.map((n, i) => {
      const angle = (i / count) * Math.PI * 2;
      const target = new THREE.Vector3(
        Math.cos(angle) * radius,
        -35 + (i % 3) * 5, // Moved contributors even lower to avoid overlap
        Math.sin(angle) * radius + 30 // Added Z offset to spread contributors back
      );

      return {
        name: (n.properties?.name as string) || `Contributor ${i}`,
        avatar_url: n.properties?.avatar_url as string,
        color: 0x6366f1,
        target,
        texture: getAvatarTexture(0x6366f1, n.properties?.avatar_url as string),
      };
    });
  }, [jarvisData]);

  const githubRepoData = useMemo(() => {
    if (!jarvisData?.nodes) return [];

    const nodes = jarvisData.nodes
      .filter((n) => n.node_type === 'GitHubRepo')
      .slice(0, 8);

    const radius = NODE_CONFIG.githubRepoDistance;
    const count = nodes.length || 1;

    return nodes.map((n, i) => {
      const angle = (i / count) * Math.PI * 2 + Math.PI / 4; // Offset from contributors
      const target = new THREE.Vector3(
        Math.cos(angle) * radius,
        2 + (i % 2) * 3, // Staggered Y levels above center
        Math.sin(angle) * radius
      );

      const iconKey = n.properties?.icon as string || 'default';
      let texture = repoIconCache.get(iconKey);

      if (!texture) {
        texture = createGitHubIconTexture(n.properties?.icon as string);
        repoIconCache.set(iconKey, texture);
      }

      return {
        name: (n.properties?.name as string) || `Repository ${i}`,
        icon: n.properties?.icon as string,
        color: 0x22d3ee,
        target,
        texture,
      };
    });
  }, [jarvisData]);

  const filesData = useMemo(() => {
    const distance = NODE_CONFIG.fileDistance;

    // If we have real directories/files data, use it
    if (directoriesData?.nodes) {
      const files = directoriesData.nodes
        .filter((n) => n.node_type === 'File')
        .slice(0, 12); // Limit to 12 files

      return files.map((file, i) => {
        const angle = (i / files.length) * Math.PI * 2;
        const radius = distance + (Math.random() - 0.5) * 5; // Add some variation
        const pos = new THREE.Vector3(
          Math.cos(angle) * radius,
          -6 + (i % 4) * 4, // Staggered Y levels for files
          Math.sin(angle) * radius
        );

        return {
          name: (file.properties?.name as string) || `File ${i}`,
          pos,
          type: 'file' as const
        };
      });
    }

    // Fallback to static files
    return [
      { name: 'package.json', pos: new THREE.Vector3(-distance * 1.2, 5, 6), type: 'file' as const },
      { name: 'README.md', pos: new THREE.Vector3(distance * 1.2, 5, -6), type: 'file' as const },
      { name: 'Dockerfile', pos: new THREE.Vector3(-distance * 0.9, -4, -8), type: 'file' as const },
      { name: 'tsconfig.json', pos: new THREE.Vector3(distance * 0.9, -4, 8), type: 'file' as const },
      { name: 'docker-compose.yml', pos: new THREE.Vector3(0, distance * 0.8, -10), type: 'file' as const },
      { name: '.env', pos: new THREE.Vector3(distance * 0.75, -7, 0), type: 'file' as const },
    ];
  }, [directoriesData]);

  const directoriesNodes = useMemo(() => {
    if (!directoriesData?.nodes) return [];

    const directories = directoriesData.nodes
      .filter((n) => n.node_type === 'Directory')
      .slice(0, 8); // Limit to 8 directories

    const distance = NODE_CONFIG.fileDistance * 0.75; // Closer than files but with proper spacing

    return directories.map((dir, i) => {
      const angle = (i / directories.length) * Math.PI * 2 + Math.PI / 8; // Offset from files
      const pos = new THREE.Vector3(
        Math.cos(angle) * distance,
        -4 + (i % 3) * 3, // Staggered Y levels for directories
        Math.sin(angle) * distance
      );

      return {
        name: (dir.properties?.name as string) || `Directory ${i}`,
        pos,
        type: 'directory' as const
      };
    });
  }, [directoriesData]);

  const statsData = useMemo(() => {
    if (!jarvisData?.nodes) return [];

    const repoNode = jarvisData.nodes.find((n) => n.node_type === 'GitHubRepo');
    const starsNode = jarvisData.nodes.find((n) => n.node_type === 'stars');

    return [
      {
        label: `${(repoNode?.properties?.commits as number) || 0} COMMITS`,
        sub: 'repository metric',
        pos: new THREE.Vector3(-NODE_CONFIG.statsDistance, 6, 0),
      },
      {
        label: `${(repoNode?.properties?.issues as number) || 0} ISSUES`,
        sub: 'repository metric',
        pos: new THREE.Vector3(NODE_CONFIG.statsDistance, 6, 0),
      },
      {
        label: `${(starsNode?.properties?.count as number) || 0} STARS`,
        sub: 'repository metric',
        pos: new THREE.Vector3(0, -NODE_CONFIG.statsDistance * 0.73, 0),
      },
      {
        label: `${(repoNode?.properties?.age_in_years as number) || 0} YEARS OLD`,
        sub: 'repository metric',
        pos: new THREE.Vector3(0, NODE_CONFIG.statsDistance * 0.73, 0),
      },
    ];
  }, [jarvisData]);

  const contributorLines = useMemo(
    () =>
      contributorData.map((c) => {
        const { x, y, z } = c.target;
        return new Float32Array([0, 0, 0, x, y, z]);
      }),
    [contributorData]
  );

  const fileLines = useMemo(
    () =>
      filesData.map((f) => {
        const { x, y, z } = f.pos;
        return new Float32Array([0, 0, 0, x, y, z]);
      }),
    [filesData]
  );

  // --------------------------------------------------------
  // ANIMATION
  // --------------------------------------------------------

  const tempVec = useRef(new THREE.Vector3()).current;

  useFrame((state) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }
    const elapsed = state.clock.elapsedTime - startTimeRef.current;

    // Smooth group position animation
    targetGroupPosition.current.set(0, -nodeTypes.length * 500 / 2, 0);
    currentGroupPosition.current.lerp(targetGroupPosition.current, 0.02); // Smooth interpolation

    if (groupRef.current) {
      groupRef.current.position.copy(currentGroupPosition.current);
    }

    // Camera orbital animation
    if (cameraOrbitActive && cameraControlsRef) {
      const animationStartTime = CAMERA_CONFIG.cameraAnimationStartDelay + CAMERA_CONFIG.orbitStartDelay;
      const orbitTime = elapsed - animationStartTime;
      const orbitSpeed = CAMERA_CONFIG.orbitSpeed;

      // Start from the initial camera position (0, 0, initialFocusDistance) and orbit from there
      const initialRadius = CAMERA_CONFIG.initialFocusDistance;
      let currentRadius = initialRadius;

      if (cameraDistancingActive) {
        const distancingStartTime = CAMERA_CONFIG.cameraAnimationStartDelay + CAMERA_CONFIG.distancingDelay;
        const distancingTime = Math.max(0, elapsed - distancingStartTime);
        const radiusGrowth = Math.pow(distancingTime, CAMERA_CONFIG.radiusGrowthExponent) * CAMERA_CONFIG.radiusGrowthMultiplier;
        const targetRadius = initialRadius + radiusGrowth;
        currentRadius = Math.min(targetRadius, CAMERA_CONFIG.maxZoomOutDistance);
      }

      // Height variation for more dynamic movement (only when orbiting)
      const heightVariation = Math.sin(orbitTime * CAMERA_CONFIG.heightVariationSpeed) * CAMERA_CONFIG.heightVariationAmplitude;

      // Start the angle from the initial position (camera was at z+initialFocusDistance, which is angle 0)
      const angle = orbitTime * orbitSpeed;
      const targetPos = new THREE.Vector3(0, 0, 0); // Look at center
      const cameraPos = new THREE.Vector3(
        Math.sin(angle) * currentRadius, // X position
        heightVariation, // Y position with variation
        Math.cos(angle) * currentRadius  // Z position (starts at positive Z where camera was)
      );

      cameraControlsRef.setLookAt(
        cameraPos.x, cameraPos.y, cameraPos.z,
        targetPos.x, targetPos.y, targetPos.z,
        false // Don't animate, we're doing it manually
      );
    }

    // central node appear
    const appearDuration = 1.0;
    const p = Math.min(elapsed / appearDuration, 1);
    const ease = 1 - Math.pow(1 - p, 3);

    if (repoRef.current) {
      const baseScale = NODE_CONFIG.centralNodeScale;
      const scale = baseScale * ease;
      repoRef.current.scale.set(scale, scale, scale);
    }

    // outer nodes delay
    const outerDelay = 1.1;
    if (!showOuterNodes && elapsed > outerDelay) {
      setShowOuterNodes(true);
    }

    if (!showOuterNodes) return;

    const t = elapsed - outerDelay;

    // contributors gently move with staggered timing
    contributorRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const c = contributorData[i];

      // Staggered delay for each contributor (0.3 seconds apart)
      const contributorDelay = i * 0.3;
      const contributorTime = Math.max(0, t - contributorDelay);

      // Slower animation speed based on time since their individual start
      const animationProgress = Math.min(contributorTime * 0.8, 1); // Slower buildup
      const lerpSpeed = 0.02 * animationProgress; // Much slower lerp speed

      tempVec.copy(c.target);
      tempVec.y += Math.sin(contributorTime * 1.2 + i * 0.6) * NODE_CONFIG.floatingAmplitude;
      mesh.position.lerp(tempVec, lerpSpeed);
    });

    // github repositories gently move (no rotation)
    githubRepoRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const repo = githubRepoData[i];

      tempVec.copy(repo.target);
      // tempVec.y += Math.sin(t * 0.8 + i * 0.8) * NODE_CONFIG.floatingAmplitude * 1.2;
      mesh.position.lerp(tempVec, 0.04);
    });

    // files rotate
    fileRefs.current.forEach((mesh) => {
      if (!mesh) return;
      mesh.rotation.y += NODE_CONFIG.rotationSpeed;
    });

    // directories gently rotate and float
    directoryRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.rotation.y += NODE_CONFIG.rotationSpeed * 0.5;
      mesh.rotation.x += NODE_CONFIG.rotationSpeed * 0.3;

      // Slight floating movement
      const originalY = directoriesNodes[i]?.pos.y || 0;
      mesh.position.y = originalY + Math.sin(t * 0.8 + i * 0.8) * 0.2;
    });
  });

  const repoLabel = useMemo(() => {
    if (workspace?.repositories?.[0]?.name) {
      return workspace.repositories[0].name;
    }

    if (jarvisData?.nodes) {
      const repoNode = jarvisData.nodes.find((n) => n.node_type === 'GitHubRepo');
      if (repoNode?.properties?.name) {
        return repoNode.properties.name as string;
      }
    }

    return 'Repository';
  }, [workspace, jarvisData]);

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  if (!jarvisData?.nodes) return null;

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* CENTRAL NODE - GitHub Repository Icon */}
      <Billboard ref={repoRef}>

        <mesh
          // ref={(m) => (githubRepoRefs.current[i] = m)}
          position={[0, 0, 0]}
          scale={[0.8, 0.8, 0.8]}
          rotation={[Math.PI, 0, 0]}
        >
          <circleGeometry args={[NODE_CONFIG.githubRepoNodeSize - 2, 48]} />
          <meshBasicMaterial
            map={githubRepoData[0].texture}
            color={"#fff"}
            // transparent
            opacity={0.98}
            side={THREE.DoubleSide}
          />
        </mesh>

      </Billboard>

      {/* CENTER LABEL */}
      <Billboard>
        <Text
          position={[0, -24, 0]}
          fontSize={20.5}
          color="#ffffff"
          outlineWidth={0.05}
          anchorX="center"
          anchorY="middle"
        >
          {repoLabel}
        </Text>
      </Billboard>

      {/* CONTRIBUTORS */}
      {showOuterNodes && showContributors &&
        contributorData.map((c, i) => (
          <Billboard key={`contrib-${i}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[contributorLines[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={c.color} transparent opacity={NODE_CONFIG.lineOpacity.contributors} />
            </line>

            <mesh
              ref={(m) => (contributorRefs.current[i] = m)}
              position={[0, 0, 0]}
            >
              <circleGeometry args={[NODE_CONFIG.contributorNodeSize, 48]} />
              <meshBasicMaterial
                map={c.texture}
                transparent
                opacity={0.98}
                side={THREE.DoubleSide}
              />
            </mesh>

            <Text
              position={[c.target.x, c.target.y - 22.2, c.target.z]}
              fontSize={9}
              color="#e5e7eb"
              anchorX="center"
              anchorY="middle"
              maxWidth={12}
            >
              {c.name}
            </Text>
          </Billboard>
        ))}

      {/* FILES */}
      {showOuterNodes && showFiles && NODE_CONFIG.showFiles &&
        filesData.map((f, i) => (
          <Billboard key={`file-${i}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[fileLines[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={0x64748b} transparent opacity={NODE_CONFIG.lineOpacity.files} />
            </line>

            <mesh ref={(m) => (fileRefs.current[i] = m)} position={f.pos}>
              <boxGeometry args={[NODE_CONFIG.fileNodeSize.width, NODE_CONFIG.fileNodeSize.height, NODE_CONFIG.fileNodeSize.depth]} />
              <meshStandardMaterial
                color={0x16171d}
                emissive={0x2a2c36}
                emissiveIntensity={0.6}
                metalness={0.6}
                roughness={0.4}
                transparent
                opacity={0.95}
              />
            </mesh>

            <Text
              position={[f.pos.x, f.pos.y - 2, f.pos.z]}
              fontSize={0.85}
              color="#e5e7eb"
              anchorX="center"
              anchorY="middle"
              maxWidth={14}
            >
              {f.name}
            </Text>
          </Billboard>
        ))}

      {/* STATS */}
      {showOuterNodes && NODE_CONFIG.showStats &&
        statsData.map((s, i) => {
          const dotPos = new THREE.Vector3(s.pos.x * 0.65, s.pos.y * 0.65, s.pos.z);

          const linePoints = new Float32Array([
            0, 0, 0,
            dotPos.x, dotPos.y, dotPos.z,
            s.pos.x, s.pos.y, s.pos.z,
          ]);

          return (
            <group key={`stat-${i}`}>
              <mesh position={dotPos}>
                <circleGeometry args={[0.45, 32]} />
                <meshBasicMaterial color={'#ffd54a'} />
              </mesh>

              <line>
                <bufferGeometry>
                  <bufferAttribute
                    attach="attributes-position"
                    args={[linePoints, 3]}
                  />
                </bufferGeometry>
                <lineBasicMaterial
                  color={'#ffd54a'}
                  linewidth={2}
                  transparent
                  opacity={NODE_CONFIG.lineOpacity.stats}
                />
              </line>

              <Html
                transform
                sprite
                distanceFactor={20}
                position={[s.pos.x, s.pos.y, s.pos.z]}
                style={{ pointerEvents: 'none' }}
              >
                <div
                  style={{
                    border: '2px solid #ffd54a',
                    padding: '14px 18px',
                    borderRadius: '6px',
                    color: '#fefefe',
                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                    background: 'rgba(0, 0, 0, 0.7)',
                    backdropFilter: 'blur(4px)',
                    minWidth: '180px',
                    boxShadow: '0 0 22px rgba(255,213,74,0.3)',
                    letterSpacing: '0.03em',
                  }}
                >
                  <div
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      marginBottom: '4px',
                      textTransform: 'uppercase',
                    }}
                  >
                    {s.label}
                  </div>

                  <div
                    style={{
                      fontSize: '11px',
                      color: '#f3e3aa',
                      opacity: 0.85,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}
                  >
                    {s.sub}
                  </div>
                </div>
              </Html>
            </group>
          );
        })}

      {/* LIGHTING */}
      <ambientLight intensity={0.45} />

      <directionalLight
        ref={lightRefTopLeft}
        color="white"
        intensity={5}
        position={[
          gitseePosition.x + 10,
          gitseePosition.y - 10,
          gitseePosition.z + 20,
        ]}
      />

      <directionalLight
        ref={lightRefTopRight}
        color="white"
        intensity={5}
        position={[
          gitseePosition.x - 10,
          gitseePosition.y + 10,
          gitseePosition.z + 20,
        ]}
      />

      <spotLight
        ref={spotLightRef}
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
    </group>
  );
}
