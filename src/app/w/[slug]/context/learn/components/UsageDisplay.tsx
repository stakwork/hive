"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, Coins } from "lucide-react";

interface CumulativeUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface UsageDisplayProps {
  usage: CumulativeUsage;
}

// Sonnet pricing: $3/M input, $15/M output
const INPUT_PRICE_PER_MILLION = 3;
const OUTPUT_PRICE_PER_MILLION = 15;

function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return millions >= 10 ? `${Math.round(millions)}M` : `${millions.toFixed(1)}M`;
  }
  if (count >= 1_000) {
    const thousands = count / 1_000;
    return thousands >= 10 ? `${Math.round(thousands)}k` : `${thousands.toFixed(1)}k`;
  }
  return count.toString();
}

function formatCost(dollars: number): string {
  if (dollars < 0.01) {
    return "<$0.01";
  }
  if (dollars < 1) {
    return `$${dollars.toFixed(2)}`;
  }
  if (dollars < 10) {
    return `$${dollars.toFixed(2)}`;
  }
  return `$${dollars.toFixed(0)}`;
}

function calculateCost(inputTokens: number, outputTokens: number): number {
  const inputCost = (inputTokens / 1_000_000) * INPUT_PRICE_PER_MILLION;
  const outputCost = (outputTokens / 1_000_000) * OUTPUT_PRICE_PER_MILLION;
  return inputCost + outputCost;
}

export function UsageDisplay({ usage }: UsageDisplayProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const totalCost = calculateCost(usage.inputTokens, usage.outputTokens);

  return (
    <div className="relative">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="p-1.5 rounded-md hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
        title="View usage"
      >
        <Coins className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-8 z-50 w-48 bg-popover border border-border rounded-lg shadow-lg p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-foreground">Cumulative Usage</span>
              <button
                onClick={() => setIsExpanded(false)}
                className="p-0.5 rounded hover:bg-muted/50 transition-colors text-muted-foreground"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Input tokens</span>
                <span className="font-mono text-foreground">{formatTokenCount(usage.inputTokens)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Output tokens</span>
                <span className="font-mono text-foreground">{formatTokenCount(usage.outputTokens)}</span>
              </div>
              <div className="border-t border-border pt-1.5 mt-1.5">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total cost</span>
                  <span className="font-mono text-foreground font-medium">{formatCost(totalCost)}</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
