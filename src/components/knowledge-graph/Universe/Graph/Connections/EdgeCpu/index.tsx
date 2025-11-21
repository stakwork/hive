// EdgesGPU.tsx
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { LinkPosition } from "../..";

//

const edgeSettings = { color: "#9194A4", opacity: 0.05, lineWidth: 1 };

type Props = {
  linksPosition: Map<string, LinkPosition>;
};

export function EdgesGPU({ linksPosition }: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const startRef = useRef<Float32Array>(new Float32Array());
  const endRef = useRef<Float32Array>(new Float32Array());

  const { size } = useThree();

  const linksArray = [...linksPosition.values()];
  const edgeCount = linksArray.length;

  // 🛡 1. Fully safe geometry creation
  const geoAndMat = useMemo(() => {
    if (edgeCount === 0) return null;

    const vCount = edgeCount * 4;
    const iCount = edgeCount * 6;

    const aStart = new Float32Array(vCount * 3);
    const aEnd = new Float32Array(vCount * 3);
    const aSide = new Float32Array(vCount);
    const aT = new Float32Array(vCount);
    const indices = new Uint32Array(iCount);

    startRef.current = aStart;
    endRef.current = aEnd;

    for (let e = 0; e < edgeCount; e++) {
      const v = e * 4;
      const i = e * 6;

      aSide[v] = -1;
      aSide[v + 1] = +1;
      aSide[v + 2] = -1;
      aSide[v + 3] = +1;

      aT[v] = 0;
      aT[v + 1] = 0;
      aT[v + 2] = 1;
      aT[v + 3] = 1;

      indices[i] = v;
      indices[i + 1] = v + 2;
      indices[i + 2] = v + 1;
      indices[i + 3] = v + 2;
      indices[i + 4] = v + 3;
      indices[i + 5] = v + 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setAttribute("aStart", new THREE.BufferAttribute(aStart, 3));
    geometry.setAttribute("aEnd", new THREE.BufferAttribute(aEnd, 3));
    geometry.setAttribute("aSide", new THREE.BufferAttribute(aSide, 1));
    geometry.setAttribute("aT", new THREE.BufferAttribute(aT, 1));

    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(edgeSettings.color) },
        uOpacity: { value: edgeSettings.opacity },
        uLineWidth: { value: edgeSettings.lineWidth },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: `
        uniform vec2 uResolution;
        uniform float uLineWidth;

        attribute vec3 aStart;
        attribute vec3 aEnd;
        attribute float aSide;
        attribute float aT;

        void main() {
          vec4 sc = projectionMatrix * modelViewMatrix * vec4(aStart, 1.0);
          vec4 ec = projectionMatrix * modelViewMatrix * vec4(aEnd, 1.0);

          vec4 clip = mix(sc, ec, aT);

          vec2 sN = sc.xy / sc.w;
          vec2 eN = ec.xy / ec.w;
          vec2 dir = normalize(eN - sN);
          vec2 normal = vec2(-dir.y, dir.x);

          float aspect = uResolution.x / uResolution.y;
          normal.x *= aspect;

          float px = uLineWidth;
          vec2 offset = normal * aSide * px / uResolution.y * 2.0;

          vec2 ndc = clip.xy / clip.w;
          ndc += offset;

          clip.xy = ndc * clip.w;
          gl_Position = clip;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
    });

    return { geometry, material };
  }, [edgeCount]);

  // 🛡 2. Guard: If geo not ready – don't render anything
  useFrame(() => {
    if (!geoAndMat || !startRef.current || !endRef.current) return;

    const { geometry, material } = geoAndMat;
    const aStart = startRef.current;
    const aEnd = endRef.current;
    const max = aStart.length;

    let v = 0;

    for (const link of linksPosition.values()) {
      if (v + 11 >= max) break; // prevents overflow

      const { sx, sy, sz, tx, ty, tz } = link;

      for (let k = 0; k < 4; k++) {
        aStart[v] = sx;
        aStart[v + 1] = sy;
        aStart[v + 2] = sz;

        aEnd[v] = tx;
        aEnd[v + 1] = ty;
        aEnd[v + 2] = tz;

        v += 3;
      }
    }

    geometry.attributes.aStart.needsUpdate = true;
    geometry.attributes.aEnd.needsUpdate = true;

    material.uniforms.uResolution.value.set(size.width, size.height);
  });

  if (!geoAndMat) return null;

  const { geometry, material } = geoAndMat;

  // 🛡 3. SAFE update loop

  return <mesh ref={meshRef} geometry={geometry} material={material} frustumCulled={false} />;
}
