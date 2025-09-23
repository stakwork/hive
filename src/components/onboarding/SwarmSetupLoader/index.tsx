"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { GraphNetworkIcon } from "@/components/onboarding/GraphNetworkIcon";

const loadingStates = [
  "Creating graph database",
  "Ingesting Code",
  "Preparing Virtual Environments",
];

export function SwarmSetupLoader() {
  const [currentStateIndex, setCurrentStateIndex] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStateIndex((prev) => (prev + 1) % loadingStates.length);
    }, 1500); // Change state every 1.5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col items-center justify-center space-y-8 py-12">
      {/* Graph network animation */}
      <div className="w-40 h-40">
        <GraphNetworkIcon size={160} animate={true} />
      </div>

      {/* Loading text */}
      <AnimatePresence mode="wait">
        <motion.p
          key={currentStateIndex}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.3 }}
          className="text-lg font-medium text-muted-foreground"
        >
          {loadingStates[currentStateIndex]}...
        </motion.p>
      </AnimatePresence>
    </div>
  );
}