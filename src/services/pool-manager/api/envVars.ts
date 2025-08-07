import { config } from "@/lib/env";
import { DevContainerFile } from "@/utils/devContainerUtils";
import { EncryptionService } from "@/lib/encryption";

const encryptionService: EncryptionService = EncryptionService.getInstance();

export async function fetchPoolEnvVars(
  poolName: string,
  poolApiKey: string,
): Promise<Array<{ key: string; value: string }>> {
  const url = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}`;
  const headers = {
    Authorization: `Bearer ${encryptionService.decryptField(
      "poolApiKey",
      poolApiKey,
    )}`,
    "Content-Type": "application/json",
  };

  const response = await fetch(url, {
    method: "GET",
    headers: headers,
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch pool env vars: ${response.status}`);
  }
  const data = await response.json();
  if (!data.config || !Array.isArray(data.config.env_vars)) {
    throw new Error("Invalid response from Pool Manager API");
  }
  return data.config.env_vars.map((env: { name: string; value: string }) => ({
    key: env.name,
    value: env.value,
  }));
}

export async function updatePoolDataApi(
  poolName: string,
  poolApiKey: string,
  envVars: Array<{ name: string; value: string }>,
  currentEnvVars: Array<{ name: string; value: string; masked?: boolean }>,
  containerFiles: Record<string, DevContainerFile>,
): Promise<void> {
  const url = `${config.POOL_MANAGER_BASE_URL}/pools/${encodeURIComponent(poolName)}`;
  const currentMap = new Map(
    currentEnvVars.map((env) => [env.name, env.value]),
  );
  const envVarsForApi = envVars.map(({ name, value }) => {
    const currentValue = currentMap.get(name);
    if (currentValue === undefined) {
      return { name: name, value, masked: false };
    } else if (currentValue !== value) {
      return { name: name, value, masked: false };
    } else {
      return { name: name, value, masked: true };
    }
  });
  const body = JSON.stringify({
    env_vars: envVarsForApi,
    devcontainer_json: Buffer.from(
      containerFiles["devcontainer_json"].content,
    ).toString("base64"),
    dockerfile: Buffer.from(containerFiles["dockerfile"].content).toString(
      "base64",
    ),
    docker_compose_yml: Buffer.from(
      containerFiles["docker_compose_yml"].content,
    ).toString("base64"),
    pm2_config_js: Buffer.from(
      containerFiles["pm2_config_js"].content,
    ).toString("base64"),
  });

  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${encryptionService.decryptField("poolApiKey", poolApiKey)}`,
      "Content-Type": "application/json",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Failed to update pool env vars: ${response.status}`);
  }
  // Don't return the response JSON since we don't need it
}
