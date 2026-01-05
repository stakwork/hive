import { useRef, useState, _useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, useCursor } from '@react-three/drei';
import * as THREE from 'three';
import { useSpring, animated } from '@react-spring/three';
import { FireParticles } from './FireParticles';

interface ServerModelProps {
    position: [number, number, number];
    state: string;
    usageStatus?: 'used' | 'unused';
    cpuUsage?: string; // e.g. "0.05"
    memoryUsage?: string; // e.g. "3.99"
    name: string;
    subdomain?: string;
    userInfo?: string | null;
    created?: string;
    repoName?: string;
    onClick?: () => void;
    selected?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
    RUNNING: '#10b981', // Emerald 500
    PENDING: '#f59e0b', // Amber 500
    FAILED: '#ef4444', // Red 500
    STOPPED: '#64748b', // Slate 500
    UNKNOWN: '#64748b',
};

// Traffic light color for resource usage (green -> amber -> red)
function getUsageColor(percentage: number): string {
    if (percentage < 60) return '#10b981'; // Green
    if (percentage < 80) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
}

export function ServerModel({ position, state, usageStatus, cpuUsage = "0", memoryUsage = "0", _name, subdomain, userInfo, _created, repoName, onClick, selected }: ServerModelProps) {
    const meshRef = useRef<THREE.Group>(null);
    const [hovered, setHover] = useState(false);
    useCursor(hovered);

    const normalizedState = state?.toUpperCase() || 'UNKNOWN';
    const color = STATUS_COLORS[normalizedState] || STATUS_COLORS.UNKNOWN;
    const isUsed = usageStatus === 'used';

    // Parse stats for visual logic
    const cpuVal = parseFloat(cpuUsage) || 0;

    // Pulse animation state
    const [intensity, setIntensity] = useState(1);
    const [activityLed, setActivityLed] = useState(0);

    useFrame((state) => {
        if (!meshRef.current) return;

        // Subtle floating animation
        meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime * 0.5) * 0.05;

        // Pulse status light (Power LED)
        if (normalizedState === 'RUNNING' || normalizedState === 'PENDING') {
            const t = state.clock.elapsedTime;
            setIntensity(1 + Math.sin(t * 5) * 0.5);
        } else if (normalizedState === 'FAILED') {
            const t = state.clock.elapsedTime;
            setIntensity(1 + Math.sin(t * 15) * 0.8); // Fast blink for error
        } else {
            setIntensity(0.2);
        }

        // Activity LED Logic (Blue)
        // Blink speed depends on CPU usage
        // Base speed + CPU factor
        const blinkSpeed = 5 + (cpuVal * 50);
        setActivityLed(Math.sin(state.clock.elapsedTime * blinkSpeed) > 0 ? 1 : 0.2);
    });

    const { scale, y, z } = useSpring({
        scale: selected ? 1.05 : (hovered ? 1.02 : 1),
        y: selected ? position[1] + 0.2 : position[1],
        z: isUsed ? position[2] + 0.6 : position[2], // Pull out 1/4 length when in use
        config: { tension: 200, friction: 20 }
    });

    return (
        <animated.group
            ref={meshRef}
            position-x={position[0]}
            position-z={z}
            position-y={y}
            scale={scale}
            onClick={(e) => {
                e.stopPropagation();
                onClick?.();
            }}
            onPointerOver={() => setHover(true)}
            onPointerOut={() => setHover(false)}
        >
            {/* Main Chassis - 2U Server Blade style */}
            <mesh castShadow receiveShadow position={[0, 0, 0]}>
                <boxGeometry args={[1.8, 0.4, 2.5]} />
                <meshStandardMaterial
                    color="#1a1a1a"
                    roughness={0.3}
                    metalness={0.8}
                />
            </mesh>

            {/* Front Panel */}
            <group position={[0, 0, 1.26]}>
                {/* Panel Base */}
                <mesh position={[0, 0, 0]}>
                    <boxGeometry args={[1.78, 0.38, 0.02]} />
                    <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.5} />
                </mesh>

                {/* Info Screen "Black Card" (Left Side) - Integrated */}
                <group position={[-0.4, 0, 0.025]}>
                    {/* Text and Bars rendered directly on the face */}

                    {/* Status Text */}
                    <Text
                        position={[-0.4, 0.08, 0.01]}
                        fontSize={0.08}
                        color={isUsed ? '#60a5fa' : color}
                        anchorX="left"
                        anchorY="middle"
                    >
                        {isUsed ? 'IN USE' : (normalizedState === 'RUNNING' ? 'AVAILABLE' : normalizedState)}
                    </Text>

                    {/* CPU Bar & Text */}
                    <group position={[-0.4, -0.02, 0.01]}>
                        <Text
                            position={[0, 0, 0]}
                            fontSize={0.05}
                            color="#94a3b8"
                            anchorX="left"
                            anchorY="middle"
                        >
                            CPU
                        </Text>
                        {/* Bar Background */}
                        <mesh position={[0.45, 0, 0]}>
                            <planeGeometry args={[0.5, 0.04]} />
                            <meshBasicMaterial color="#1e293b" />
                        </mesh>
                        {/* Bar Fill */}
                        <mesh position={[0.2 + (Math.min(cpuVal, 100) / 100 * 0.5) / 2, 0, 0.001]}>
                            <planeGeometry args={[Math.min(cpuVal, 100) / 100 * 0.5, 0.04]} />
                            <meshBasicMaterial color={getUsageColor(cpuVal)} />
                        </mesh>
                        {/* Percentage Text */}
                        <Text
                            position={[0.45, 0, 0.002]}
                            fontSize={0.035}
                            color="white"
                            anchorX="center"
                            anchorY="middle"
                        >
                            {Math.round(cpuVal)}%
                        </Text>
                    </group>

                    {/* Memory Bar & Text */}
                    <group position={[-0.4, -0.10, 0.01]}>
                        <Text
                            position={[0, 0, 0]}
                            fontSize={0.05}
                            color="#94a3b8"
                            anchorX="left"
                            anchorY="middle"
                        >
                            MEM
                        </Text>
                        {/* Bar Background */}
                        <mesh position={[0.45, 0, 0]}>
                            <planeGeometry args={[0.5, 0.04]} />
                            <meshBasicMaterial color="#1e293b" />
                        </mesh>
                        {/* Bar Fill */}
                        <mesh position={[0.2 + (Math.min(parseFloat(memoryUsage) || 0, 100) / 100 * 0.5) / 2, 0, 0.001]}>
                            <planeGeometry args={[Math.min(parseFloat(memoryUsage) || 0, 100) / 100 * 0.5, 0.04]} />
                            <meshBasicMaterial color={getUsageColor(parseFloat(memoryUsage) || 0)} />
                        </mesh>
                        {/* Percentage Text */}
                        <Text
                            position={[0.45, 0, 0.002]}
                            fontSize={0.035}
                            color="white"
                            anchorX="center"
                            anchorY="middle"
                        >
                            {Math.round(parseFloat(memoryUsage) || 0)}%
                        </Text>
                    </group>
                </group>

                {/* Metadata Panel (Middle Black Box) */}
                <group position={[0.35, 0, 0.025]}>
                    {/* Black Background */}
                    <mesh position={[0, 0, 0]}>
                        <planeGeometry args={[0.5, 0.3]} />
                        <meshStandardMaterial color="#111111" roughness={0.8} metalness={0.2} />
                    </mesh>

                    {/* Subdomain */}
                    {subdomain && (
                        <Text
                            position={[-0.22, 0.10, 0.01]}
                            fontSize={0.045}
                            color="#64748b"
                            anchorX="left"
                            anchorY="middle"
                        >
                            {subdomain.length > 20 ? subdomain.substring(0, 20) + '...' : subdomain}
                        </Text>
                    )}

                    {/* Repository Name */}
                    {repoName && (
                        <Text
                            position={[-0.22, 0.02, 0.01]}
                            fontSize={0.035}
                            color="#94a3b8"
                            anchorX="left"
                            anchorY="middle"
                        >
                            {repoName.length > 22 ? repoName.substring(0, 22) + '...' : repoName}
                        </Text>
                    )}

                    {/* User Info (only for used servers) */}
                    {isUsed && userInfo && (
                        <Text
                            position={[-0.22, -0.08, 0.01]}
                            fontSize={0.04}
                            color="#60a5fa"
                            anchorX="left"
                            anchorY="middle"
                        >
                            {userInfo.length > 22 ? userInfo.substring(0, 22) + '...' : userInfo}
                        </Text>
                    )}
                </group>

                {/* Status LED (Power) - Far Right Top */}
                <mesh position={[0.82, 0.12, 0.02]}>
                    <circleGeometry args={[0.03, 16]} />
                    <meshBasicMaterial color={color} toneMapped={false} />
                </mesh>
                <pointLight position={[0.82, 0.12, 0.1]} color={color} intensity={intensity} distance={0.5} decay={2} />

                {/* Usage LED (In Use) - Far Right, Below Power LED */}
                {isUsed && (
                    <>
                        <mesh position={[0.82, 0.04, 0.02]}>
                            <circleGeometry args={[0.03, 16]} />
                            <meshBasicMaterial color="#60a5fa" toneMapped={false} />
                        </mesh>
                        <pointLight position={[0.82, 0.04, 0.1]} color="#60a5fa" intensity={1.5} distance={0.5} decay={2} />
                    </>
                )}

                {/* Activity LEDs (CPU Activity) - Far Right Vertical Stack */}
                <group position={[0.82, -0.05, 0.02]}>
                    <mesh position={[0, 0.08, 0]}>
                        <circleGeometry args={[0.015, 8]} />
                        <meshBasicMaterial color="#60a5fa" toneMapped={false} opacity={activityLed} transparent />
                    </mesh>
                    <mesh position={[0, 0, 0]}>
                        <circleGeometry args={[0.015, 8]} />
                        <meshBasicMaterial color="#60a5fa" toneMapped={false} opacity={activityLed * 0.7} transparent />
                    </mesh>
                    <mesh position={[0, -0.08, 0]}>
                        <circleGeometry args={[0.015, 8]} />
                        <meshBasicMaterial color="#60a5fa" toneMapped={false} opacity={activityLed * 0.5} transparent />
                    </mesh>
                </group>
            </group>

            {/* FAILED State: Fire Effect */}
            {normalizedState === 'FAILED' && (
                <group position={[0, 0.2, 0]}>
                    <FireParticles position={[0, 0, 0]} />
                </group>
            )}
        </animated.group>
    );
}
