import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

const NetworkGraph3D = () => {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });

        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setClearColor(0x000000, 1);
        containerRef.current.appendChild(renderer.domElement);

        camera.position.z = 5;

        // Create "HIVE" text in the center
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;

        canvas.width = 512;
        canvas.height = 256;

        context.fillStyle = '#ffffff';
        context.font = 'bold 120px Arial';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText('HIVE', 256, 128);

        const texture = new THREE.CanvasTexture(canvas);
        const textMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            side: THREE.DoubleSide
        });
        const textGeometry = new THREE.PlaneGeometry(2, 1);
        const textMesh = new THREE.Mesh(textGeometry, textMaterial);
        scene.add(textMesh);

        // Create nodes
        const nodeCount = 40;
        const nodes: THREE.Vector3[] = [];
        const nodeMeshes: { sphere: THREE.Mesh; glow: THREE.Mesh }[] = [];
        const radius = 2;

        for (let i = 0; i < nodeCount; i++) {
            const phi = Math.acos(-1 + (2 * i) / nodeCount);
            const theta = Math.sqrt(nodeCount * Math.PI) * phi;

            const x = radius * Math.cos(theta) * Math.sin(phi);
            const y = radius * Math.sin(theta) * Math.sin(phi);
            const z = radius * Math.cos(phi);

            nodes.push(new THREE.Vector3(x, y, z));

            const geometry = new THREE.SphereGeometry(0.05, 16, 16);
            const material = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(0.5 + i * 0.01, 1, 0.6)
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.copy(nodes[i]);

            const glowGeometry = new THREE.SphereGeometry(0.08, 16, 16);
            const glowMaterial = new THREE.MeshBasicMaterial({
                color: new THREE.Color().setHSL(0.5 + i * 0.01, 1, 0.8),
                transparent: true,
                opacity: 0.3
            });
            const glow = new THREE.Mesh(glowGeometry, glowMaterial);
            glow.position.copy(nodes[i]);

            scene.add(sphere);
            scene.add(glow);
            nodeMeshes.push({ sphere, glow });
        }

        // Create connections
        const connections: THREE.Line[] = [];
        for (let i = 0; i < nodeCount; i++) {
            for (let j = i + 1; j < nodeCount; j++) {
                const distance = nodes[i].distanceTo(nodes[j]);
                if (distance < 1.5) {
                    const geometry = new THREE.BufferGeometry().setFromPoints([nodes[i], nodes[j]]);
                    const material = new THREE.LineBasicMaterial({
                        color: 0x4dd4ff,
                        transparent: true,
                        opacity: 0.4
                    });
                    const line = new THREE.Line(geometry, material);
                    scene.add(line);
                    connections.push(line);
                }
            }
        }

        // Animation
        let time = 0;
        const animate = () => {
            requestAnimationFrame(animate);
            time += 0.005;

            // Make text always face the camera (billboard effect)
            textMesh.quaternion.copy(camera.quaternion);

            scene.rotation.y = time * 0.3;
            scene.rotation.x = Math.sin(time * 0.2) * 0.2;

            nodeMeshes.forEach((node, i) => {
                const pulseScale = 1 + Math.sin(time * 2 + i * 0.5) * 0.2;
                node.glow.scale.set(pulseScale, pulseScale, pulseScale);

                node.sphere.material.color.setHSL((0.5 + time * 0.1 + i * 0.01) % 1, 1, 0.6);
                node.glow.material.color.setHSL((0.5 + time * 0.1 + i * 0.01) % 1, 1, 0.8);
            });

            connections.forEach((line, i) => {
                line.material.opacity = 0.2 + Math.sin(time * 2 + i * 0.1) * 0.2;
            });

            renderer.render(scene, camera);
        };

        animate();

        const handleResize = () => {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (containerRef.current && renderer.domElement) {
                containerRef.current.removeChild(renderer.domElement);
            }
            renderer.dispose();
        };
    }, []);

    return <div ref={containerRef} style={{ width: '100vw', height: '100vh', margin: 0, padding: 0 }} />;
};

export default NetworkGraph3D;