import type { JarvisResponse } from '@/types/jarvis';
import { Billboard, Text } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

interface CentralRepositoryProps {
  repoData: JarvisResponse | null;
  repoLabel: string;
  githubRepoNodeSize: number;
  centralNodeScale: number;
  elapsed: number;
  isVisible: boolean;
  isLoading?: boolean;
}

export const CentralRepository = ({
  repoData,
  repoLabel,
  githubRepoNodeSize,
  centralNodeScale,
  elapsed,
  isVisible,
  isLoading = false,
}: CentralRepositoryProps) => {
  const repoRef = useRef<THREE.Group>(null);

  // Get first GitHub repo data for texture
  const firstRepo = repoData?.nodes?.find(n => n.node_type === 'GitHubRepo');

  const createDefaultTexture = () => {
    if (typeof document === 'undefined') {
      const data = new Uint8Array([255, 255, 255, 255]);
      const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
      tex.needsUpdate = true;
      return tex;
    }

    const loader = new THREE.TextureLoader();
    const tex = loader.load('/gitimage.png', (t) => {
      t.anisotropy = 8;
      t.flipY = false;
      t.wrapS = THREE.ClampToEdgeWrapping;
      t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
    });
    return tex;
  };

  const defaultTexture = useMemo(() => createDefaultTexture(), []);
  const [texture, setTexture] = useState<THREE.Texture>(defaultTexture);

  // Attempt to load custom icon; keep default until load success
  useEffect(() => {
    const iconUrl = firstRepo?.properties?.icon as string | undefined;
    if (!iconUrl || typeof document === 'undefined') {
      setTexture(defaultTexture);
      return;
    }

    let cancelled = false;
    const loader = new THREE.TextureLoader();

    loader.load(
      iconUrl,
      (tex) => {
        if (cancelled) return;
        tex.anisotropy = 8;
        tex.flipY = false;
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.needsUpdate = true;
        setTexture(tex);
      },
      undefined,
      (error) => {
        console.warn('Failed to load repository icon, keeping default:', error);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [firstRepo?.properties?.icon, defaultTexture]);

  // Central node appear animation
  const appearDuration = 1.0;
  const p = Math.min(elapsed / appearDuration, 1);
  const ease = 1 - Math.pow(1 - p, 3);
  let scale = centralNodeScale * ease;

  // Add subtle pulsing animation when loading
  if (isLoading && !repoData) {
    const pulseSpeed = 2.0;
    const pulseAmplitude = 0.1;
    const pulse = Math.sin(elapsed * pulseSpeed) * pulseAmplitude + 1;
    scale *= pulse;
  }

  if (!isVisible) return null;

  return (
    <>
      {/* CENTRAL NODE - GitHub Repository Icon */}
      <Billboard ref={repoRef}>
        <mesh
          position={[0, 0, 0]}
          scale={[scale * 0.8, scale * 0.8, scale * 0.8]}
          rotation={[Math.PI, 0, 0]}
        >
          <circleGeometry args={[githubRepoNodeSize - 2, 48]} />
          <meshBasicMaterial
            map={texture}
            color="#fff"
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
    </>
  );
};
