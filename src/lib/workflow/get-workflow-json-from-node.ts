/**
 * Extracts the workflow JSON string from a graph Workflow_version node.
 * The graph API may store the payload under `properties.body` (new) or
 * `properties.workflow_json` (legacy), or directly on `node.workflow_json`.
 * Returns undefined if no value is found.
 */
export function getWorkflowJsonFromNode(node: unknown): string | undefined {
  const n = node as Record<string, any> | undefined;
  const raw =
    n?.properties?.body ??
    n?.properties?.workflow_json ??
    n?.workflow_json;
  if (!raw) return undefined;
  return typeof raw === 'string' ? raw : JSON.stringify(raw);
}
