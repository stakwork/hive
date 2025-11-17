'use client';

import { useDataStore, useRepositoryNodes } from '@/stores/useDataStore';
import { Billboard, Html, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
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
  const fileRefs = useRef<(THREE.Mesh | null)[]>([]);
  const startTimeRef = useRef<number | null>(null);

  // lighting refs
  const lightRefTopLeft = useRef<THREE.DirectionalLight>(null);
  const lightRefTopRight = useRef<THREE.DirectionalLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);

  const [showOuterNodes, setShowOuterNodes] = useState(false);

  const repositoryNodes = useRepositoryNodes();
  const dataInitial = useDataStore((s) => s.dataInitial);
  const hasGraphNodes = dataInitial?.nodes && dataInitial.nodes.length > 0;

  // position GitSee vs main graph
  const gitseePosition = useMemo(() => {
    if (hasGraphNodes) {
      return new THREE.Vector3(150, 100, 0);
    }
    return new THREE.Vector3(0, 0, 0);
  }, [hasGraphNodes]);

  // --------------------------------------------------------
  // DATA
  // --------------------------------------------------------

  const contributorData = useMemo(() => {
    const nodes = repositoryNodes
      .filter((n) => n.node_type === 'Contributor')
      .slice(0, 12);

    const radius = 18;
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
        texture: getAvatarTexture(0x6366f1, n.properties.avatar_url),
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
      { name: '.env', pos: new THREE.Vector3(9, -7, 0) },
    ],
    []
  );

  // 📌 FINAL CALLOUT DISTANCES (bigger, cleaner)
  const statsData = useMemo(() => {
    const commitsNode = repositoryNodes.find((n) => n.node_type === 'Commits');
    const starsNode = repositoryNodes.find((n) => n.node_type === 'Stars');
    const issuesNode = repositoryNodes.find((n) => n.node_type === 'Issues');
    const ageNode = repositoryNodes.find((n) => n.node_type === 'Age');

    return [
      {
        label: `${commitsNode?.properties?.total_commits || 0} COMMITS`,
        sub: 'repository metric',
        pos: new THREE.Vector3(-30, 6, 0),
      },
      {
        label: `${issuesNode?.properties?.total_issues || 0} ISSUES`,
        sub: 'repository metric',
        pos: new THREE.Vector3(30, 6, 0),
      },
      {
        label: `${starsNode?.properties?.stars || 0} STARS`,
        sub: 'repository metric',
        pos: new THREE.Vector3(0, -22, 0),
      },
      {
        label: `${ageNode?.properties?.age_in_years || 0} YEARS OLD`,
        sub: 'repository metric',
        pos: new THREE.Vector3(0, 22, 0),
      },
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
      const baseScale = 2.0;
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

    // contributors gently move
    contributorRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const c = contributorData[i];

      tempVec.copy(c.target);
      tempVec.y += Math.sin(t * 1.2 + i * 0.6) * 0.15;
      mesh.position.lerp(tempVec, 0.05);
    });

    // files rotate
    fileRefs.current.forEach((mesh) => {
      if (!mesh) return;
      mesh.rotation.y += 0.002;
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
      {/* CENTRAL NODE */}
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

      {/* CONTRIBUTORS */}
      {
        showOuterNodes &&
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
              position={[0, 0, 0]}
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
        ))
      }

      {/* FILES */}
      {
        showOuterNodes &&
        filesData.map((f, i) => (
          <Billboard key={`file-${i}`}>
            <line>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[fileLines[i], 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial
                color={0x64748b}
                transparent
                opacity={0.2}
              />
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
        ))
      }

      {/* 🔥 STATS — FINAL CALL-OUT STYLE */}
      {
        showOuterNodes &&
        statsData.map((s, i) => {
          // calculate dot position (70% toward the callout)
          const dotPos = new THREE.Vector3(
            s.pos.x * 0.65,
            s.pos.y * 0.65,
            s.pos.z
          );

          const linePoints = new Float32Array([
            0, 0, 0, // center
            dotPos.x, dotPos.y, dotPos.z,
            s.pos.x, s.pos.y, s.pos.z,
          ]);

          return (
            <group key={`stat-${i}`}>

              {/* yellow dot */}
              <mesh position={dotPos}>
                <circleGeometry args={[0.45, 32]} />
                <meshBasicMaterial color={'#ffd54a'} />
              </mesh>

              {/* line from center to dot to callout */}
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
                  opacity={0.9}
                />
              </line>

              {/* HTML callout box */}
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
                    fontFamily:
                      'Inter, system-ui, -apple-system, sans-serif',
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
        })
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
