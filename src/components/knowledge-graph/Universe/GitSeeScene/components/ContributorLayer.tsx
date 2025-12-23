import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { RepositoryData } from '@/types/github';

interface ContributorData {
  name: string;
  avatar_url: string;
  color: number;
  target: THREE.Vector3;
  texture: THREE.Texture;
}

interface ContributorLayerProps {
  repositoryData: RepositoryData | null;
  contributorDistance: number;
  contributorNodeSize: number;
  floatingAmplitude: number;
  lineOpacity: number;
  isVisible: boolean;
  startTime: number | null;
}

// Avatar texture cache
const avatarCache = new Map<string, THREE.Texture>();

function getAvatarTexture(color: number, avatarUrl?: string, label?: string) {
  const key = avatarUrl || `color-${color}-${(label || '').slice(0, 1).toLowerCase()}`;
  const cached = avatarCache.get(key);
  if (cached) return cached;

  // SSR-safe fallback
  if (typeof document === 'undefined') {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    avatarCache.set(key, tex);
    return tex;
  }

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    avatarCache.set(key, tex);
    return tex;
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  avatarCache.set(key, tex);

  // fallback background
  const hex = `#${color.toString(16).padStart(6, '0')}`;
  ctx.fillStyle = hex;
  ctx.fillRect(0, 0, size, size);

  if (label) {
    ctx.fillStyle = '#0b1224';
    ctx.font = 'bold 110px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label.slice(0, 1).toUpperCase(), size / 2, size / 2 + 8);
  }
  tex.needsUpdate = true;

  if (avatarUrl) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.45, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, 0, 0, size, size);
      ctx.restore();
      tex.needsUpdate = true;
    };
    img.onerror = () => {
      console.warn('Avatar load failed', avatarUrl);
      tex.needsUpdate = true; // keep fallback
    };
    img.src = avatarUrl;
  }

  return tex;
}

export const ContributorLayer = ({
  repositoryData,
  contributorDistance,
  contributorNodeSize,
  floatingAmplitude,
  lineOpacity,
  isVisible,
  startTime,
}: ContributorLayerProps) => {
  const contributorRefs = useRef<(THREE.Mesh | null)[]>([]);
  const tempVec = useRef(new THREE.Vector3()).current;

  // Process contributor data from GitHub API
  const contributorData = useMemo((): ContributorData[] => {
    if (!repositoryData?.contributors) return [];

    const contributors = repositoryData.contributors.slice(0, 12);
    const radius = contributorDistance;
    const count = contributors.length || 1;

    return contributors.map((contributor, i) => {
      const angle = (i / count) * Math.PI * 2;
      const target = new THREE.Vector3(
        Math.cos(angle) * radius,
        -35 + (i % 3) * 5, // Positioned lower to avoid overlap
        Math.sin(angle) * radius + 30 // Z offset for depth
      );

      return {
        name: contributor.login || `Contributor ${i}`,
        avatar_url: contributor.avatar_url,
        color: 0x6366f1,
        target,
        texture: getAvatarTexture(0x6366f1, contributor.avatar_url, contributor.login),
      };
    });
  }, [repositoryData, contributorDistance]);

  // Create line geometry for connections to center
  const contributorLines = useMemo(
    () =>
      contributorData.map((c) => {
        const { x, y, z } = c.target;
        return new Float32Array([0, 0, 0, x, y, z]);
      }),
    [contributorData]
  );

  // Animation frame for staggered movement
  useFrame((state) => {
    if (!isVisible || !startTime || contributorData.length === 0) return;

    const elapsed = state.clock.elapsedTime - startTime;
    const outerDelay = 1.1; // Base delay before any contributors start moving
    const t = elapsed - outerDelay;

    if (t <= 0) return; // Haven't started yet

    // Contributors move with staggered timing
    contributorRefs.current.forEach((mesh, i) => {
      if (!mesh || !contributorData[i]) return;
      const c = contributorData[i];

      // Staggered delay for each contributor (0.3 seconds apart)
      const contributorDelay = i * 0.3;
      const contributorTime = Math.max(0, t - contributorDelay);

      // Slower animation speed based on time since their individual start
      const animationProgress = Math.min(contributorTime * 0.8, 1); // Slower buildup
      const lerpSpeed = 0.02 * animationProgress; // Much slower lerp speed

      tempVec.copy(c.target);
      tempVec.y += Math.sin(contributorTime * 1.2 + i * 0.6) * floatingAmplitude;
      mesh.position.lerp(tempVec, lerpSpeed);
    });
  });

  if (!isVisible || contributorData.length === 0) return null;

  return (
    <>
      {contributorData.map((c, i) => (
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
              opacity={lineOpacity}
            />
          </line>

          <mesh
            ref={(m) => (contributorRefs.current[i] = m)}
            position={[0, 0, 0]}
          >
            <circleGeometry args={[contributorNodeSize, 48]} />
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
    </>
  );
};
