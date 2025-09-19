export function parseEnv(envContent: string): Record<string, string> {
  const result: Record<string, string> = {};

  const lines = envContent.split('\n');

  for (const line of lines) {
    // Skip empty lines and comments
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Find the first = sign
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) {
      continue; // Skip lines without =
    }

    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();

    // Handle quoted values
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (key) {
      result[key] = value;
    }
  }

  return result;
}