'use client';

import { useWorkspace } from '@/hooks/useWorkspace';
import { useControlStore } from '@/stores/useControlStore';
import { useDataStore } from '@/stores/useStores';
import { Billboard, Html, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// AVATAR TEXTURE CACHE
// --------------------------------------------------------

const avatarCache = new Map<string, THREE.Texture>();

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

// --------------------------------------------------------
// MAIN SCENE
// --------------------------------------------------------

export function RepositoryScene() {
  const repoRef = useRef<THREE.Group>(null);
  const contributorRefs = useRef<(THREE.Mesh | null)[]>([]);
  const contributorGroupRefs = useRef<(THREE.Group | null)[]>([]);
  const startTimeRef = useRef<number | null>(null);
  const hasNavigatedRef = useRef(false);
  const nextIndexRef = useRef(0);

  // lighting refs
  const lightRefTopLeft = useRef<THREE.DirectionalLight>(null);
  const lightRefTopRight = useRef<THREE.DirectionalLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);

  const [showOuterNodes, setShowOuterNodes] = useState(false);
  const [slotIndices, setSlotIndices] = useState<number[]>([]);

  const { workspace } = useWorkspace();
  const dataInitial = useDataStore((s) => s.dataInitial);
  const repositoryNodes = useDataStore((s) => s.repositoryNodes);
  const hasGraphNodes = dataInitial?.nodes && dataInitial.nodes.length > 0;
  const cameraControlsRef = useControlStore((s) => s.cameraControlsRef);


  console.log('GitSee Debug:', {
    repositoryNodesCount: repositoryNodes.length,
    hasGraphNodes,
    repositoryNodeTypes: repositoryNodes.map(n => n.node_type),
    allDataNodes: dataInitial?.nodes?.length || 0
  });

  // position GitSee vs main graph - closer to main view
  const gitseePosition = useMemo(() => {
    if (hasGraphNodes) {
      return new THREE.Vector3(80, 50, 0);
    }
    return new THREE.Vector3(0, 0, 0);
  }, [hasGraphNodes]);

  // Auto-navigate to GitSee scene on initialization
  useEffect(() => {
    if (repositoryNodes.length > 0 && cameraControlsRef && !hasNavigatedRef.current) {
      hasNavigatedRef.current = true;

      const center = new THREE.Vector3(gitseePosition.x, gitseePosition.y, gitseePosition.z);
      const radius = hasGraphNodes ? 85 : 60; // tighter frame to keep GitHub mini-graph close

      const sphere = new THREE.Sphere(center, radius);

      // Navigate to the GitSee scene with smooth transition
      cameraControlsRef.fitToSphere(sphere, true);
    }
  }, [repositoryNodes.length, cameraControlsRef, gitseePosition, hasGraphNodes]);

  // --------------------------------------------------------
  // DATA
  // --------------------------------------------------------

  const contributorData = useMemo(() => {
    const nodes = repositoryNodes
      .filter((n) => n.node_type === 'Contributor')
      .slice(0, 12);

    const count = nodes.length || 1;
    const rows = Math.min(3, Math.max(1, Math.ceil(count / 4)));

    // distribute nodes per row
    const rowSizes: number[] = [];
    let remaining = count;
    for (let r = 0; r < rows; r++) {
      const left = rows - r;
      const size = Math.ceil(remaining / left);
      rowSizes.push(size);
      remaining -= size;
    }

    return nodes.map((n, i) => {
      let rowIndex = 0;
      let offset = i;
      for (let r = 0; r < rowSizes.length; r++) {
        if (offset < rowSizes[r]) {
          rowIndex = r;
          break;
        }
        offset -= rowSizes[r];
      }

      const inRowCount = rowSizes[rowIndex] || 1;
      const t = inRowCount > 1 ? offset / (inRowCount - 1) : 0.5;
      const rowSpread = rows === 1 ? 22 : rows === 2 ? 26 : 28;
      const x = (t - 0.5) * rowSpread;
      const yStep = 6;
      const y = (rowIndex - (rows - 1) / 2) * -yStep;
      const z = Math.sin((t - 0.5) * Math.PI) * 4 + rowIndex * -0.6;
      const target = new THREE.Vector3(x, y, z);

      return {
        name: n.properties?.name || 'Unknown Contributor',
        contributions: n.properties?.contributions || 0,
        avatar_url: n.properties?.avatar_url,
        color: 0x6366f1,
        id: n.ref_id || n.properties?.id || n.properties?.name || `contrib-${i}`,
        target,
        wobblePhase: Math.random() * Math.PI * 2,
        rowIndex,
        texture: getAvatarTexture(0x6366f1, n.properties?.avatar_url),
      };
    });
  }, [repositoryNodes]);

  // Active rotating contributors (spotlight 3D ring)
  const activeCount = useMemo(
    () => Math.max(1, Math.min(5, contributorData.length || 0)),
    [contributorData.length]
  );

  // initialize slot indices when data changes
  useEffect(() => {
    if (contributorData.length === 0) {
      setSlotIndices([]);
      return;
    }
    nextIndexRef.current = activeCount % contributorData.length;
    setSlotIndices(Array.from({ length: activeCount }).map((_, i) => i % contributorData.length));
  }, [contributorData.length, activeCount]);

  // rotate one slot at a time for smooth replacements
  useEffect(() => {
    if (contributorData.length <= activeCount || activeCount === 0) return;
    let tick = 0;
    const interval = setInterval(() => {
      tick += 1;
      const slotToAdvance = tick % activeCount;
      setSlotIndices((prev) => {
        if (prev.length === 0) return prev;
        const activeSet = new Set(prev);
        let candidate = nextIndexRef.current % contributorData.length;
        let attempts = 0;
        const maxAttempts = contributorData.length;
        while (attempts < maxAttempts && activeSet.has(candidate)) {
          candidate = (candidate + 1) % contributorData.length;
          attempts += 1;
        }

        const next = [...prev];
        next[slotToAdvance] = candidate;
        nextIndexRef.current = (candidate + 1) % contributorData.length;
        return next;
      });
    }, 1800);
    return () => clearInterval(interval);
  }, [contributorData.length, activeCount]);

  const activeContributors = useMemo(() => {
    if (contributorData.length === 0 || slotIndices.length === 0) return [];
    return slotIndices.map((dataIndex, slotIndex) => {
      const source = contributorData[dataIndex % contributorData.length];
      return {
        ...source,
        slotIndex,
      };
    });
  }, [slotIndices, contributorData]);

  const slotPositions = useMemo(
    () =>
      activeContributors.map((_, slotIndex) => {
        const angle = (slotIndex / Math.max(1, activeCount)) * Math.PI * 2 + Math.PI / 2;
        const radius = 16;
        const yArc = Math.sin(angle * 1.3) * 3.2;
        return new THREE.Vector3(
          Math.cos(angle) * radius,
          yArc,
          Math.sin(angle) * radius
        );
      }),
    [activeContributors, activeCount]
  );

  const activeSlots = useMemo(
    () =>
      activeContributors.map((c, slotIndex) => ({
        ...c,
        target: slotPositions[slotIndex],
      })),
    [activeContributors, slotPositions]
  );

  const activeSlotsRef = useRef<typeof activeSlots>([]);
  useEffect(() => {
    activeSlotsRef.current = activeSlots;
  }, [activeSlots]);

  // --------------------------------------------------------
  // ANIMATION
  // --------------------------------------------------------

  const tempVec = useRef(new THREE.Vector3()).current;

  useFrame((state) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }
    const elapsed = state.clock.elapsedTime - startTimeRef.current;

    // central node appear
    const appearDuration = 1.0;
    const p = Math.min(elapsed / appearDuration, 1);
    const ease = 1 - Math.pow(1 - p, 3);

    if (repoRef.current) {
      const baseScale = 2.6;
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

    // contributors gently orbit and wobble; only active slots are rendered
    const orbitRadius = 16;
    const angleOffset = t * 0.4;

    activeSlotsRef.current.forEach((c, idx) => {
      const mesh = contributorRefs.current[idx];
      const group = contributorGroupRefs.current[idx];
      if (!mesh || !group) return;

      const angle = (c.slotIndex / Math.max(1, activeSlotsRef.current.length)) * Math.PI * 2 + angleOffset;
      const yArc = Math.sin(angle * 1.3) * 3.2;
      tempVec.set(
        Math.cos(angle) * orbitRadius,
        yArc,
        Math.sin(angle) * orbitRadius
      );

      const wobble = Math.sin(t * 1.1 + c.wobblePhase) * 0.35;
      tempVec.y += wobble * 0.4;
      tempVec.x += Math.cos(t * 0.7 + c.wobblePhase) * 0.3;
      tempVec.z += Math.sin(t * 0.8 + c.wobblePhase) * 0.35;

      group.position.lerp(tempVec, 0.12);
    });

    // files removed
  });

  // Don't render if no repository nodes available
  if (repositoryNodes.length === 0) {
    console.log('GitSee: No repository nodes found, not rendering repository scene');
    return null;
  }

  // Get repository name from workspace data (more accurate than node properties)
  const repoLabel = useMemo(() => {
    if (workspace?.repositories?.[0]?.name) {
      return workspace.repositories[0].name;
    }

    // Fallback to node properties if workspace doesn't have repository data
    const repoNode = repositoryNodes.find((n) => n.node_type === 'GitHubRepo');
    return repoNode?.properties?.name || 'Repository';
  }, [workspace, repositoryNodes]);

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  return (
    <group position={[gitseePosition.x, gitseePosition.y, gitseePosition.z]}>
      {/* CENTRAL GITHUB NODE */}
      <group ref={repoRef}>
        {/* Background circle */}
        {/* <mesh scale={[1, 1, 1]}>
          <circleGeometry args={[1, 64]} />
          <meshStandardMaterial
            color={0x24292e}
            emissive={0x161b22}
            emissiveIntensity={0.3}
          />
        </mesh> */}

        {/* GitHub icon using HTML/CSS */}
        <Html
          center
          occlude={false}
          sprite
          zIndexRange={[100, 101]}
          position={[0, 0, 0.1]}
        >
          <div
            style={{
              width: '140px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '10px',
              pointerEvents: 'none',
              textAlign: 'center',
              fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
            }}
          >
            <div
              style={{
                width: '76px',
                height: '76px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <svg
                width="56"
                height="56"
                viewBox="0 0 24 24"
                fill="white"
                style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.3))' }}
              >
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
              </svg>
            </div>
            <div
              style={{
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '16px',
                textShadow: '0 4px 18px rgba(0,0,0,0.45)',
                letterSpacing: '0.04em',
              }}
            >
              {repoLabel}
            </div>
          </div>
        </Html>

        {/* Subtle border rings */}
        {/* <lineSegments>
          <edgesGeometry args={[new THREE.RingGeometry(2.9, 3.2, 72)]} />
          <lineBasicMaterial color={0xffffff} transparent opacity={0.25} />
        </lineSegments>
        <lineSegments>
          <edgesGeometry args={[new THREE.RingGeometry(8.5, 8.8, 96)]} />
          <lineBasicMaterial color={'#374151'} transparent opacity={0.2} />
        </lineSegments>
        <lineSegments>
          <edgesGeometry args={[new THREE.RingGeometry(13, 13.3, 96)]} />
          <lineBasicMaterial color={'#1f2937'} transparent opacity={0.18} />
        </lineSegments> */}
      </group>

      {/* CONTRIBUTORS */}
      {
        showOuterNodes &&
        activeSlots.map((c, i) => (
          <group key={`contrib-slot-${i}`} ref={(g) => (contributorGroupRefs.current[i] = g)}>
            <Billboard>
              <mesh
                ref={(m) => (contributorRefs.current[i] = m)}
                position={[0, 0, 0]}
              >
                <circleGeometry args={[1.8, 48]} />
                <meshBasicMaterial
                  map={c.texture}
                  transparent
                  opacity={0.98}
                  side={THREE.DoubleSide}
                />
              </mesh>

              <Text
                position={[0, -2.2, 0]}
                fontSize={0.9}
                color="#e5e7eb"
                anchorX="center"
                anchorY="middle"
                maxWidth={12}
              >
                {c.name}
              </Text>
            </Billboard>
          </group>
        ))
      }

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
        color="lime"
        penumbra={1}
        intensity={5}
      />

      <pointLight
        intensity={500}
        color="lime"
        position={[gitseePosition.x, gitseePosition.y, gitseePosition.z]}
      />
    </group >
  );
}
