import type { RepositoryData } from '@/types/github';
import { Billboard, Html, Text } from '@react-three/drei';

interface CentralRepositoryProps {
  repositoryData: RepositoryData | null;
  repoLabel: string;
  githubRepoNodeSize: number;
  centralNodeScale: number;
  elapsed: number;
  isVisible: boolean;
  isLoading?: boolean;
}

export const CentralRepository = ({
  repositoryData,
  repoLabel,
  githubRepoNodeSize,
  centralNodeScale,
  elapsed,
  isVisible,
  isLoading = false,
}: CentralRepositoryProps) => {

  // Central node appear animation
  const appearDuration = 1.0;
  const p = Math.min(elapsed / appearDuration, 1);
  const ease = 1 - Math.pow(1 - p, 3);
  let scale = centralNodeScale * ease;

  // Add subtle pulsing animation when loading
  if (isLoading && !repositoryData) {
    const pulseSpeed = 2.0;
    const pulseAmplitude = 0.1;
    const pulse = Math.sin(elapsed * pulseSpeed) * pulseAmplitude + 1;
    scale *= pulse;
  }

  if (!isVisible) return null;

  return (
    <>
      {/* CENTRAL NODE - GitHub Repository Icon as HTML */}


      {/* CENTER LABEL */}
      <Billboard>
        <Html
          position={[24, 0, 0]}
          transform
          sprite
          distanceFactor={1000}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              width: `${(githubRepoNodeSize - 2) * 2 * scale * 0.8}px`,
              height: `${(githubRepoNodeSize - 2) * 2 * scale * 0.8}px`,
              borderRadius: '50%',
              background: 'url(/gitimage.png) center/cover white',
              border: '2px solid #fff',
              boxShadow: '0 0 10px rgba(0,0,0,0.3)',
              transform: 'translate(-50%, -50%)',
              backfaceVisibility: 'hidden',
              WebkitBackfaceVisibility: 'hidden',
            }}
          />
        </Html>
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
