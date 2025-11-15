'use client';

import { useRepositoryNodes, useDataStore } from '@/stores/useDataStore';
import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

// --------------------------------------------------------
// AVATAR TEXTURE CACHE (no disappearing images)
// --------------------------------------------------------

const avatarCache = new Map<string, THREE.Texture>();

function getAvatarTexture(color: number, avatarUrl?: string) {
  const key = avatarUrl || `color-${color}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;

  // SSR-safe: if no document, return 1x1 texture
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
  const fileRefs = useRef<(THREE.Mesh | null)[]>([]);
  const statRefs = useRef<(THREE.Mesh | null)[]>([]);
  const startTimeRef = useRef<number | null>(null);

  // Enhanced lighting refs
  const lightRefTopLeft = useRef<THREE.DirectionalLight>(null);
  const lightRefTopRight = useRef<THREE.DirectionalLight>(null);
  const lightRefBottomLeft = useRef<THREE.DirectionalLight>(null);
  const lightRefBottomRight = useRef<THREE.DirectionalLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);

  const [showOuterNodes, setShowOuterNodes] = useState(false);

  const repositoryNodes = useRepositoryNodes();

  // Check if we have graph nodes to determine positioning
  const dataInitial = useDataStore((s) => s.dataInitial);
  const hasGraphNodes = dataInitial?.nodes && dataInitial.nodes.length > 0;

  // Position GitSee away from main graph when both are present
  const gitseePosition = useMemo(() => {
    if (hasGraphNodes) {
      // Move GitSee to the side/above when graph nodes are present
      return new THREE.Vector3(150, 100, 0); // Off to the side and elevated
    }
    return new THREE.Vector3(0, 0, 0); // Center when only GitSee
  }, [hasGraphNodes]);

  // Lighting configuration
  const lightingConfig = useMemo(() => ({
    spotLight: true,
    directionalLightTopLeft: true,
    directionalLightTopRight: true,
    directionalLightBottomLeft: false,
    directionalLightBottomRight: false,
  }), []);

  // Set up lighting to point towards GitSee center
  useEffect(() => {
    const { x, y, z } = gitseePosition;

    if (lightingConfig.directionalLightTopLeft && lightRefTopLeft.current) {
      lightRefTopLeft.current.target.position.set(x, y, z);
      lightRefTopLeft.current.target.updateMatrixWorld();
    }
    if (lightingConfig.directionalLightTopRight && lightRefTopRight.current) {
      lightRefTopRight.current.target.position.set(x, y, z);
      lightRefTopRight.current.target.updateMatrixWorld();
    }
    if (lightingConfig.directionalLightBottomLeft && lightRefBottomLeft.current) {
      lightRefBottomLeft.current.target.position.set(x, y, z);
      lightRefBottomLeft.current.target.updateMatrixWorld();
    }
    if (lightingConfig.directionalLightBottomRight && lightRefBottomRight.current) {
      lightRefBottomRight.current.target.position.set(x, y, z);
      lightRefBottomRight.current.target.updateMatrixWorld();
    }
  }, [lightingConfig, gitseePosition]);

  // --------------------------------------------------------
  // DATA
  // --------------------------------------------------------

  const contributorData = useMemo(() => {
    const nodes = repositoryNodes
      .filter((n) => n.node_type === 'Contributor')
      .slice(0, 12);

    const radius = 18; // medium distance
    const count = nodes.length || 1;

    return nodes.map((n, i) => {
      const angle = (i / count) * Math.PI * 2;
      const target = new THREE.Vector3(
        Math.cos(angle) * radius,
        (Math.random() - 0.5) * 3,
        Math.sin(angle) * radius
      );

      return {
        name: n.properties.name,
        contributions: n.properties.contributions,
        avatar_url: n.properties.avatar_url,
        color: 0x6366f1,
        target,
        texture: getAvatarTexture(0x6366f1, n.properties.avatar_url)
      };
    });
  }, [repositoryNodes]);

  const filesData = useMemo(
    () => [
      { name: 'package.json', pos: new THREE.Vector3(-14, 5, 6) },
      { name: 'README.md', pos: new THREE.Vector3(14, 5, -6) },
      { name: 'Dockerfile', pos: new THREE.Vector3(-11, -4, -8) },
      { name: 'tsconfig.json', pos: new THREE.Vector3(11, -4, 8) },
      { name: 'docker-compose.yml', pos: new THREE.Vector3(0, 10, -10) },
      { name: '.env', pos: new THREE.Vector3(9, -7, 0) }
    ],
    []
  );

  const statsData = useMemo(() => {
    const commitsNode = repositoryNodes.find((n) => n.node_type === 'Commits');
    const starsNode = repositoryNodes.find((n) => n.node_type === 'Stars');
    const issuesNode = repositoryNodes.find((n) => n.node_type === 'Issues');
    const ageNode = repositoryNodes.find((n) => n.node_type === 'Age');

    return [
      {
        name: `${commitsNode?.properties?.total_commits || 0} commits`,
        pos: new THREE.Vector3(-16, 0, 0)
      },
      {
        name: `${issuesNode?.properties?.total_issues || 0} issues`,
        pos: new THREE.Vector3(16, 2, 0)
      },
      {
        name: `${starsNode?.properties?.stars || 0} stars`,
        pos: new THREE.Vector3(0, -10, 0)
      },
      {
        name: `${ageNode?.properties?.age_in_years || 0}y old`,
        pos: new THREE.Vector3(0, 10, 2)
      }
    ];
  }, [repositoryNodes]);

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

  const statLines = useMemo(
    () =>
      statsData.map((s) => {
        const { x, y, z } = s.pos;
        return new Float32Array([0, 0, 0, x, y, z]);
      }),
    [statsData]
  );

  // --------------------------------------------------------
  // ANIMATION: staged appearance
  // --------------------------------------------------------

  const tempVec = useRef(new THREE.Vector3()).current;

  useFrame((state) => {
    if (startTimeRef.current === null) {
      startTimeRef.current = state.clock.elapsedTime;
    }
    const elapsed = state.clock.elapsedTime - startTimeRef.current;

    // 1) Central node appear (scale from 0 → 2, a bit of wobble)
    const appearDuration = 1.0;
    const p = Math.min(elapsed / appearDuration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // easeOutCubic

    if (repoRef.current) {
      const baseScale = 2.0;
      const scale = baseScale * ease;
      repoRef.current.scale.set(scale, scale, scale);

      // subtle idle wobble - disabled for better camera control
      // const wobbleTime = Math.max(elapsed - appearDuration, 0);
      // repoRef.current.rotation.y = wobbleTime * 0.25;
      // repoRef.current.rotation.x = Math.sin(wobbleTime * 0.4) * 0.05;
    }

    // 2) After delay, show outer nodes
    const outerDelay = 1.1;
    if (!showOuterNodes && elapsed > outerDelay) {
      setShowOuterNodes(true);
    }

    if (!showOuterNodes) return;

    const t = elapsed - outerDelay;

    // Contributors: move center -> target, very gentle bob
    contributorRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const c = contributorData[i];

      tempVec.copy(c.target);
      tempVec.y += Math.sin(t * 1.2 + i * 0.6) * 0.15; // very gentle bob

      mesh.position.lerp(tempVec, 0.01);
    });

    // Files: rotate slowly
    fileRefs.current.forEach((mesh) => {
      if (!mesh) return;
      mesh.rotation.y += 0.002;
    });

    // Stats: slight tilt
    statRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      mesh.rotation.y = Math.sin(t * 0.7 + i) * 0.1;
    });
  });

  if (repositoryNodes.length === 0) return null;

  const repoNode = repositoryNodes.find((n) => n.node_type === 'GitHubRepo');
  const repoLabel =
    typeof repoNode?.properties?.name === 'string'
      ? repoNode.properties.name
      : 'Repository';

  // --------------------------------------------------------
  // RENDER
  // --------------------------------------------------------

  return (
    <group position={[gitseePosition.x, gitseePosition.y, gitseePosition.z]}>
      {/* CENTRAL NODE (appears first) */}
      <group ref={repoRef}>
        <mesh scale={[0.5, 0.5, 0.5]}>
          <icosahedronGeometry args={[1.6, 3]} />
          <meshStandardMaterial
            color={0x45c66e}
            emissive={0x2e8b4b}
            emissiveIntensity={0.9}
            metalness={0.9}
            roughness={0.2}
          />
        </mesh>
        <lineSegments>
          <edgesGeometry args={[new THREE.IcosahedronGeometry(1.6, 2)]} />
          <lineBasicMaterial color={0xffffff} transparent opacity={0.3} />
        </lineSegments>
      </group>

      {/* CENTER LABEL */}
      <Billboard>
        <Text
          position={[0, 4.2, 0]}
          fontSize={1.5}
          color="#ffffff"
          outlineWidth={0.05}
          anchorX="center"
          anchorY="middle"
        >
          {repoLabel}
        </Text>
        <Text
          position={[0, 3, 0]}
          fontSize={0.85}
          color="#94a3b8"
          anchorX="center"
          anchorY="middle"
        >
          GitHub Repository Overview
        </Text>
      </Billboard>

      {/* CONTRIBUTORS (appear after central) */}
      {showOuterNodes &&
        contributorData.map((c, i) => (
          <Billboard key={`contrib-${i}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[contributorLines[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={c.color}
                transparent
                opacity={0.25}
              />
            </line>

            <mesh
              ref={(m) => (contributorRefs.current[i] = m)}
              position={[0, 0, 0]} // start at center, then lerp to target
            >
              <circleGeometry args={[1.5, 48]} />
              <meshBasicMaterial
                map={c.texture}
                transparent
                opacity={0.98}
                side={THREE.DoubleSide}
              />
            </mesh>

            <Text
              position={[c.target.x, c.target.y - 2.2, c.target.z]}
              fontSize={0.9}
              color="#e5e7eb"
              anchorX="center"
              anchorY="middle"
              maxWidth={12}
            >
              {c.name}
            </Text>
            <Text
              position={[c.target.x, c.target.y - 3.1, c.target.z]}
              fontSize={0.7}
              color="#9ca3af"
              anchorX="center"
              anchorY="middle"
              maxWidth={12}
            >
              {c.contributions} contributions
            </Text>
          </Billboard>
        ))}

      {/* FILES */}
      {showOuterNodes &&
        filesData.map((f, i) => (
          <Billboard key={`file-${i}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[fileLines[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={0x64748b} transparent opacity={0.2} />
            </line>

            <mesh
              ref={(m) => (fileRefs.current[i] = m)}
              position={f.pos}
            >
              <boxGeometry args={[4, 2.5, 0.3]} />
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
      {showOuterNodes &&
        statsData.map((s, i) => (
          <Billboard key={`stat-${i}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[statLines[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={0x334155} transparent opacity={0.15} />
            </line>

            <mesh
              ref={(m) => (statRefs.current[i] = m)}
              position={s.pos}
            >
              <boxGeometry args={[5.2, 1.8, 0.35]} />
              <meshStandardMaterial
                color={0x020617}
                emissive={0x111827}
                emissiveIntensity={0.7}
                metalness={0.7}
                roughness={0.25}
                transparent
                opacity={0.9}
              />
            </mesh>

            <Text
              position={[s.pos.x, s.pos.y, s.pos.z + 0.5]}
              fontSize={0.9}
              color="#e5e7eb"
              anchorX="center"
              anchorY="middle"
              maxWidth={18}
            >
              {s.name}
            </Text>
          </Billboard>
        ))}

      {/* ENHANCED LIGHTING SETUP */}
      <ambientLight intensity={0.5} />

      {/* Directional lights with targeted positioning */}
      {lightingConfig.directionalLightTopLeft && (
        <directionalLight
          ref={lightRefTopLeft}
          color="white"
          intensity={5}
          position={[gitseePosition.x + 10, gitseePosition.y - 10, gitseePosition.z + 20]}
        />
      )}
      {lightingConfig.directionalLightTopRight && (
        <directionalLight
          ref={lightRefTopRight}
          color="white"
          intensity={5}
          position={[gitseePosition.x - 10, gitseePosition.y + 10, gitseePosition.z + 20]}
        />
      )}
      {lightingConfig.directionalLightBottomLeft && (
        <directionalLight
          ref={lightRefBottomLeft}
          color="white"
          intensity={5}
          position={[gitseePosition.x - 10, gitseePosition.y + 10, gitseePosition.z + 20]}
        />
      )}
      {lightingConfig.directionalLightBottomRight && (
        <directionalLight
          ref={lightRefBottomRight}
          color="white"
          intensity={5}
          position={[gitseePosition.x + 10, gitseePosition.y - 10, gitseePosition.z + 20]}
        />
      )}

      {/* Spot light for dramatic effect */}
      {lightingConfig.spotLight && (
        <spotLight
          ref={spotLightRef}
          position={[gitseePosition.x + 10, gitseePosition.y + 5, gitseePosition.z]}
          angle={0.15}
          color="lime"
          penumbra={1}
          intensity={5}
          target-position={[gitseePosition.x, gitseePosition.y, gitseePosition.z]}
        />
      )}

      {/* Central point light */}
      <pointLight
        intensity={500}
        color="lime"
        position={[gitseePosition.x, gitseePosition.y, gitseePosition.z]}
      />
    </group>
  );
}
