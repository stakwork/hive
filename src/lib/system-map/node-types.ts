/**
 * The node types of the `systemmap` namespace, as the Materialize workflow
 * writes them (SystemMap ontology v0.3; `Actor` is the older spelling of
 * `SysActor`, still present in materialized graphs). jarvis' node listing
 * takes an allowlist of types and no blocklist, so a request that leaves a
 * type out has to name every other one — keep this in step with the ontology
 * or the type silently disappears from the tab.
 */
export const SYSTEM_MAP_NODE_TYPES = [
  "SysTrustZone",
  "SysComponent",
  "SysInterface",
  "SysResource",
  "SysDataAsset",
  "SysDataFlow",
  "SysPrincipal",
  "SysActor",
  "Actor",
  "SysTechnology",
  "SysCapability",
  "SysOperation",
  "SysArtifact",
  "SysProtocol",
  "SysPackage",
] as const;

/**
 * Types the Domain nodes tab reads only when asked: packages are a few hundred
 * nodes and a thousand edges that only the Dependencies view needs, and the
 * materializer promotes every TypeScript interface to a data asset, which
 * buries the real ones.
 */
export const ON_DEMAND_NODE_TYPES: { type: string; label: string }[] = [
  { type: "SysPackage", label: "packages" },
  { type: "SysDataAsset", label: "data assets" },
];

/** What the tab asks for first. */
export const DEFAULT_NODE_TYPES: string[] = SYSTEM_MAP_NODE_TYPES.filter(
  (type) => !ON_DEMAND_NODE_TYPES.some((d) => d.type === type),
);

const TYPE_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_TYPES = 64;

/**
 * The `types` query parameter of the nodes route: a comma-separated allowlist
 * of node types. Absent or empty means every type; `null` means the value is
 * not a list of type names.
 */
export function parseNodeTypesParam(value: string | null | undefined): string[] | undefined | null {
  if (value === null || value === undefined) return undefined;
  const types = [
    ...new Set(
      value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  if (types.length === 0) return undefined;
  if (types.length > MAX_TYPES || types.some((t) => !TYPE_NAME.test(t))) return null;
  return types;
}
