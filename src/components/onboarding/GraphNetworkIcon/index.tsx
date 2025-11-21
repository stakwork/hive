"use client";

import { motion } from "framer-motion";

interface GraphNetworkIconProps {
  size?: number;
  animate?: boolean;
}

export function GraphNetworkIcon({ size = 160, animate = true }: GraphNetworkIconProps) {
  const scale = size / 160;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="w-full h-full"
    >
      {/* Central hexagon connections - strong blue like main branch */}
      <motion.path
        d="M 80 30 L 120 50 L 120 90 L 80 110 L 40 90 L 40 50 Z"
        stroke="#0969da"
        strokeWidth="3"
        fill="none"
        initial={{ pathLength: 0 }}
        animate={animate ? { pathLength: 1 } : { pathLength: 1 }}
        transition={{ duration: 2, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />

      {/* Blue edges from hexagon corners to center */}
      <motion.path
        d="M 80 30 L 80 70 M 120 50 L 80 70 M 120 90 L 80 70 M 80 110 L 80 70 M 40 90 L 80 70 M 40 50 L 80 70"
        stroke="#0969da"
        strokeWidth="2"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 0.7 } : { pathLength: 1, opacity: 0.7 }}
        transition={{ duration: 2, delay: 0.3, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />

      {/* Top Branch - purple (1 to 3) */}
      <motion.path
        d="M 80 30 L 80 10 M 80 30 L 100 10 M 80 30 L 60 10"
        stroke="#8250df"
        strokeWidth="2.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, delay: 0.5, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />

      {/* Right Branches - green (1 to 2) */}
      <motion.path
        d="M 120 50 L 140 40 M 120 50 L 140 60"
        stroke="#1f883d"
        strokeWidth="2.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, delay: 1, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />
      <motion.path
        d="M 120 90 L 140 90"
        stroke="#1f883d"
        strokeWidth="2.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, delay: 1.2, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />

      {/* Bottom Branch - orange (1 to 3) */}
      <motion.path
        d="M 80 110 L 80 130 M 80 110 L 100 130 M 80 110 L 60 130"
        stroke="#fb8500"
        strokeWidth="2.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, delay: 1.5, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />

      {/* Left Branches - red (1 to 2) */}
      <motion.path
        d="M 40 50 L 20 40 M 40 50 L 20 60"
        stroke="#da2e65"
        strokeWidth="2.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, delay: 2, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />
      <motion.path
        d="M 40 90 L 20 90"
        stroke="#da2e65"
        strokeWidth="2.5"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={animate ? { pathLength: 1, opacity: 1 } : { pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.8, delay: 2.2, ease: "easeInOut", repeat: animate ? Infinity : 0 }}
      />

      {/* Central node - blue */}
      <motion.circle
        cx="80"
        cy="70"
        r="6"
        fill="#0969da"
        initial={{ scale: 0, opacity: 0 }}
        animate={animate ? { scale: [0, 1.3, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
        transition={{
          duration: 0.5,
          delay: 0,
          repeat: animate ? Infinity : 0,
          repeatDelay: 1.5,
        }}
      />

      {/* Hexagon corner nodes - blue like main */}
      {[
        { x: 80, y: 30 },
        { x: 120, y: 50 },
        { x: 120, y: 90 },
        { x: 80, y: 110 },
        { x: 40, y: 90 },
        { x: 40, y: 50 },
      ].map((node, index) => (
        <motion.circle
          key={`hex-${index}`}
          cx={node.x}
          cy={node.y}
          r="5"
          fill="#0969da"
          initial={{ scale: 0, opacity: 0 }}
          animate={animate ? { scale: [0, 1.3, 1], opacity: 1 } : { scale: 1, opacity: 1 }}
          transition={{
            duration: 0.5,
            delay: index * 0.3,
            repeat: animate ? Infinity : 0,
            repeatDelay: 1.5,
          }}
        />
      ))}

      {/* Branch end nodes - matching branch colors */}
      {/* Top Purple branch nodes (1 to 3) */}
      <motion.circle
        cx="80"
        cy="10"
        r="4"
        fill="#8250df"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 1.2, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="100"
        cy="10"
        r="4"
        fill="#8250df"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 1.3, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="60"
        cy="10"
        r="4"
        fill="#8250df"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 1.4, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />

      {/* Right Green branch nodes (1 to 2, then 1 to 1) */}
      <motion.circle
        cx="140"
        cy="40"
        r="4"
        fill="#1f883d"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 1.7, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="140"
        cy="60"
        r="4"
        fill="#1f883d"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 1.8, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="140"
        cy="90"
        r="4"
        fill="#1f883d"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 1.9, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />

      {/* Bottom Orange branch nodes (1 to 3) */}
      <motion.circle
        cx="80"
        cy="130"
        r="4"
        fill="#fb8500"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 2.2, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="100"
        cy="130"
        r="4"
        fill="#fb8500"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 2.3, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="60"
        cy="130"
        r="4"
        fill="#fb8500"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 2.4, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />

      {/* Left Red branch nodes */}
      <motion.circle
        cx="20"
        cy="40"
        r="4"
        fill="#da2e65"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 2.5, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="20"
        cy="60"
        r="4"
        fill="#da2e65"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 2.6, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
      <motion.circle
        cx="20"
        cy="90"
        r="4"
        fill="#da2e65"
        initial={{ scale: 0 }}
        animate={animate ? { scale: [0, 1.2, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, delay: 2.7, repeat: animate ? Infinity : 0, repeatDelay: 1.5 }}
      />
    </svg>
  );
}
