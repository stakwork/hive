import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

export function FireParticles({ position }: { position: [number, number, number] }) {
    const count = 20;
    const mesh = useRef<THREE.InstancedMesh>(null);

    const dummy = useMemo(() => new THREE.Object3D(), []);
    const particles = useMemo(() => {
        const temp = [];
        for (let i = 0; i < count; i++) {
            const t = Math.random() * 100;
            const factor = 0.2 + Math.random() * 0.8;
            const speed = 0.01 + Math.random() * 0.03;
            const xFactor = -0.2 + Math.random() * 0.4;
            const yFactor = -0.2 + Math.random() * 0.4;
            const zFactor = -0.2 + Math.random() * 0.4;
            temp.push({ t, factor, speed, xFactor, yFactor, zFactor, mx: 0, my: 0 });
        }
        return temp;
    }, [count]);

    useFrame((_state) => {
        if (!mesh.current) return;

        particles.forEach((particle, i) => {
            let { t, _factor, speed, _xFactor, _yFactor, _zFactor } = particle;
            t = particle.t += speed / 2;
            const _a = Math.cos(t) + Math.sin(t * 1) / 10;
            const _b = Math.sin(t) + Math.cos(t * 2) / 10;
            const s = Math.cos(t);

            // Move up and fade
            particle.my = (particle.my + speed) % 1.5;

            dummy.position.set(
                (particle.xFactor + Math.cos(t / 10)) * 0.2 + position[0],
                particle.my + position[1],
                (particle.zFactor + Math.sin(t / 10)) * 0.2 + position[2]
            );

            // Scale down as it goes up
            const scale = (1.5 - particle.my) * 0.3;
            dummy.scale.set(scale, scale, scale);

            dummy.rotation.set(s * 5, s * 5, s * 5);
            dummy.updateMatrix();

            if (mesh.current) {
                mesh.current.setMatrixAt(i, dummy.matrix);

                // Color gradient from yellow to red to smoke
                const color = new THREE.Color();
                if (particle.my < 0.3) color.set('#fbbf24'); // Yellow
                else if (particle.my < 0.8) color.set('#ef4444'); // Red
                else color.set('#57534e'); // Smoke

                mesh.current.setColorAt(i, color);
            }
        });
        mesh.current.instanceMatrix.needsUpdate = true;
        if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    });

    return (
        <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
            <boxGeometry args={[0.2, 0.2, 0.2]} />
            <meshBasicMaterial transparent opacity={0.6} />
        </instancedMesh>
    );
}
