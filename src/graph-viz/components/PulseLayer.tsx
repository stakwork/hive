import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Pulse } from "./GraphView";

const MAX_PULSES = 32;

// Traveling dot: billboard that always faces camera
const dotVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec3 instancePos = vec3(instanceMatrix[3]);
    float s = length(vec3(instanceMatrix[0]));
    vec4 mvPosition = modelViewMatrix * vec4(instancePos, 1.0);
    float screenScale = -mvPosition.z / projectionMatrix[1][1];
    mvPosition.xy += (position.xy * s) * screenScale * 0.08;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const dotFragmentShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vec2 coord = (vUv - 0.5) * 2.0;
    float r = length(coord);
    // Bright core + soft glow
    float core = 1.0 - smoothstep(0.0, 0.2, r);
    float glow = exp(-r * r * 4.0) * 0.8;
    float a = core + glow;
    if (a < 0.01) discard;
    vec3 color = vec3(0.6, 0.95, 1.0) * (core * 2.0 + glow);
    gl_FragColor = vec4(color, a);
  }
`;

const _tmpObj = new THREE.Object3D();

interface PulseLayerProps {
  pulses: Pulse[];
  positionsRef: React.RefObject<Float32Array>;
}

export function PulseLayer({ pulses, positionsRef }: PulseLayerProps) {
  const lineRef = useRef<THREE.LineSegments>(null);
  const dotRef = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    const positions = positionsRef.current;
    if (!positions) return;

    const activePulses = pulses.slice(0, MAX_PULSES);
    const count = activePulses.length;

    // Update traveling dots
    const dots = dotRef.current;
    if (dots) {
      for (let i = 0; i < MAX_PULSES; i++) {
        if (i < count) {
          const p = activePulses[i];
          const s3 = p.src * 3;
          const d3 = p.dst * 3;
          // Lerp position along edge
          const t = p.progress;
          const x = positions[s3] + (positions[d3] - positions[s3]) * t;
          const y = positions[s3 + 1] + (positions[d3 + 1] - positions[s3 + 1]) * t;
          const z = positions[s3 + 2] + (positions[d3 + 2] - positions[s3 + 2]) * t;
          _tmpObj.position.set(x, y, z);
          // Scale: peaks in middle of travel, fades at ends
          const envelope = Math.sin(t * Math.PI);
          _tmpObj.scale.setScalar(0.4 + 0.6 * envelope);
        } else {
          _tmpObj.position.set(0, -1000, 0);
          _tmpObj.scale.setScalar(0);
        }
        _tmpObj.updateMatrix();
        dots.setMatrixAt(i, _tmpObj.matrix);
      }
      dots.instanceMatrix.needsUpdate = true;
    }

    // Update highlight edge lines
    const line = lineRef.current;
    if (line) {
      const posArr = new Float32Array(count * 6);
      const alphaArr = new Float32Array(count * 2);

      for (let i = 0; i < count; i++) {
        const p = activePulses[i];
        const s3 = p.src * 3;
        const d3 = p.dst * 3;
        const base = i * 6;

        // Edge from source to current dot position (lit portion)
        posArr[base] = positions[s3];
        posArr[base + 1] = positions[s3 + 1];
        posArr[base + 2] = positions[s3 + 2];
        // End at the traveling dot
        const t = p.progress;
        posArr[base + 3] = positions[s3] + (positions[d3] - positions[s3]) * t;
        posArr[base + 4] = positions[s3 + 1] + (positions[d3 + 1] - positions[s3 + 1]) * t;
        posArr[base + 5] = positions[s3 + 2] + (positions[d3 + 2] - positions[s3 + 2]) * t;

        // Bright at source, bright at dot
        const envelope = Math.sin(t * Math.PI);
        alphaArr[i * 2] = 0.3 * envelope;
        alphaArr[i * 2 + 1] = 1.0 * envelope;
      }

      const geom = line.geometry as THREE.BufferGeometry;
      geom.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
      geom.setAttribute("alpha", new THREE.BufferAttribute(alphaArr, 1));
      geom.attributes.position.needsUpdate = true;
      geom.attributes.alpha.needsUpdate = true;
      geom.setDrawRange(0, count * 2);
    }
  });

  return (
    <>
      {/* Bright edge trail */}
      <lineSegments ref={lineRef} frustumCulled={false}>
        <bufferGeometry />
        <shaderMaterial
          vertexShader={`
            attribute float alpha;
            varying float vAlpha;
            void main() {
              vAlpha = alpha;
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying float vAlpha;
            void main() {
              gl_FragColor = vec4(0.5, 0.95, 1.0, vAlpha);
            }
          `}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </lineSegments>

      {/* Traveling dots */}
      <instancedMesh ref={dotRef} args={[undefined, undefined, MAX_PULSES]} frustumCulled={false}>
        <planeGeometry args={[2, 2]} />
        <shaderMaterial
          vertexShader={dotVertexShader}
          fragmentShader={dotFragmentShader}
          transparent
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </>
  );
}
