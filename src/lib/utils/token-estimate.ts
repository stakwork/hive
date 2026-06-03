import { encode } from "gpt-tokenizer";

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export function formatTokenCount(count: number): string {
  if (count >= 1000) return `~${Math.round(count / 100) / 10}k tokens`;
  return `~${count} tokens`;
}
