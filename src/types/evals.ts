export type PromptResolution = {
  prompt_id: number;
  prompt_version_id: number;
  resolution: Record<string, unknown>;
};

export function mapPromptResolutions(
  resolutions: Record<string, PromptResolution> | null | undefined
): Array<{ name: string; prompt_id: number; prompt_version_id: number; resolution?: string }> | undefined {
  if (!resolutions) return undefined;
  const mapped = Object.entries(resolutions).map(([name, { prompt_id, prompt_version_id, resolution }]) => ({
    name,
    prompt_id,
    prompt_version_id,
    ...(resolution?.value != null ? { resolution: String(resolution.value) } : {}),
  }));
  return mapped.length > 0 ? mapped : undefined;
}
