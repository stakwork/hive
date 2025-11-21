import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface ServerParticlesProps {
  position: [number, number, number];
  active: boolean;
  intensity: number; // 0 to 1, based on CPU/Memory usage
}

export function ServerParticles({ position, active, intensity }: ServerParticlesProps) {
  const count = Math.floor(20 * intensity) + 5; // More particles for higher load
  const mesh = useRef<THREE.InstancedMesh>(null);

  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Generate random initial positions and velocities
  const particles = useMemo(() => {
    const temp = [];
    for (let i = 0; i < 50; i++) {
      const t = Math.random() * 100;
      const factor = 20 + Math.random() * 100;
      const speed = 0.01 + Math.random() / 200;
      const xFactor = -0.5 + Math.random();
      const yFactor = -0.5 + Math.random();
      const zFactor = -0.5 + Math.random();
      temp.push({ t, factor, speed, xFactor, yFactor, zFactor, mx: 0, my: 0 });
    }
    return temp;
  }, []);

  useFrame((state) => {
    if (!mesh.current || !active) return;

    particles.forEach((particle, i) => {
      // Calculate particle movement
      let { t, factor, speed, xFactor, yFactor, zFactor } = particle;
      t = particle.t += speed / 2;
      const a = Math.cos(t) + Math.sin(t * 1) / 10;
      const b = Math.sin(t) + Math.cos(t * 2) / 10;
      const s = Math.cos(t);

      // Update position relative to server center
      dummy.position.set(
        (particle.mx / 10) * a + xFactor + Math.cos((t / 10) * factor) + (Math.sin(t * 1) * factor) / 10,
        (particle.my / 10) * b + yFactor + Math.sin((t / 10) * factor) + (Math.cos(t * 2) * factor) / 10,
        (particle.my / 10) * b + zFactor + Math.cos((t / 10) * factor) + (Math.sin(t * 3) * factor) / 10,
      );

      // Scale based on intensity
      const scale = (s * 0.1 + 0.1) * intensity;
      dummy.scale.set(scale, scale, scale);

      // Orbit around the server position
      dummy.position.add(new THREE.Vector3(...position));

      // Constrain to area around server
      const radius = 1.2;
      const offset = new THREE.Vector3().subVectors(dummy.position, new THREE.Vector3(...position));
      if (offset.length() > radius) {
        offset.normalize().multiplyScalar(radius);
        dummy.position.copy(new THREE.Vector3(...position).add(offset));
      }

      dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix);
    });

    mesh.current.instanceMatrix.needsUpdate = true;
  });

  if (!active || intensity <= 0.1) return null;

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <dodecahedronGeometry args={[0.1, 0]} />
      <meshBasicMaterial color="#60a5fa" transparent opacity={0.6} />
    </instancedMesh>
  );
}
