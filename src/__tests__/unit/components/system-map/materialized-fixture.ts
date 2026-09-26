/** A trimmed `swarm-systemmap-graph-materialize` output, shaped like the real run. */
export const MATERIALIZED_FIXTURE = {
  note: "Ontology fetched directly from Infosec, then materialized into concrete, evidence-backed graph instances.",
  coverage: {
    byType: {},
    edgesAccepted: 1,
    edgesRejected: 3,
    nodesAccepted: 1,
    nodesRejected: 4,
    allowedEdgeTypes: 21,
    allowedNodeTypes: 144,
    observedEdgeTypes: 1,
    observedNodeTypes: 1,
  },
  sessionId: "b96fecc5-4ef1-4e01-9db2-c960f4a7e073",
  swarm_url: "https://swarm38.sphinx.chat:3355",
  observedGraph: {
    nodes: [
      {
        id: "tech:postgres",
        type: "SysRelationalDatabaseTechnology",
        properties: { name: "PostgreSQL" },
        evidence: ["repo:stakwork/hive, file:package.json, dependency:@prisma/client"],
      },
    ],
    edges: [{ edge_type: "USES_TECHNOLOGY", source_id: "tech:postgres", target_id: "tech:postgres", evidence: ["self"] }],
  },
  rejectedItems: [
    {
      item: {
        type: "SysWebApplication",
        evidence: ['repo:stakwork/hive, file:package.json, field:"name": "hive"'],
        properties: { name: "hive", description: "Main Next.js web application for the Hive platform" },
        proposed_id: "app:hive",
      },
      kind: "node",
      reasons: ["missing_required_properties:id"],
    },
    {
      item: {
        type: "SysFrameworkTechnology",
        evidence: ["repo:stakwork/hive, file:package.json, dependency:next"],
        properties: { name: "Next.js" },
        proposed_id: "tech:nextjs",
      },
      kind: "node",
      reasons: ["missing_required_properties:id"],
    },
    {
      item: {
        type: "SysFrameworkTechnology",
        evidence: ["repo:stakwork/staklink, file:package.json, dependency:express"],
        properties: { name: "Express" },
        proposed_id: "tech:express",
      },
      kind: "node",
      reasons: ["missing_required_properties:id"],
    },
    {
      item: {
        type: "SysCacheInstance",
        evidence: ["repo:stakwork/hive, file:src/lib/redis.ts, symbol:createRedisClient, config:REDIS_URL"],
        properties: { name: "hive Redis instance (REDIS_URL)" },
        proposed_id: "cache:hive-redis-instance",
      },
      kind: "node",
      reasons: ["missing_required_properties:id"],
    },
    {
      item: { evidence: ["repo:stakwork/hive, file:package.json, dependency:next"], edge_type: "USES_TECHNOLOGY", source_id: "app:hive", target_id: "tech:nextjs" },
      kind: "edge",
      reasons: ["missing_endpoint:source", "missing_endpoint:target"],
    },
    {
      item: { evidence: ["repo:stakwork/hive, file:src/lib/redis.ts"], edge_type: "CONNECTS_TO", source_id: "app:hive", target_id: "cache:hive-redis-instance" },
      kind: "edge",
      reasons: ["missing_endpoint:source", "missing_endpoint:target"],
    },
    {
      item: { evidence: ["repo:stakwork/staklink, file:src/server.ts"], edge_type: "USES_TECHNOLOGY", source_id: "svc:staklink-ext-server", target_id: "tech:express" },
      kind: "edge",
      reasons: ["missing_endpoint:source"],
    },
  ],
  logsAnnotations: { edges: [], nodeTypes: [] },
  ontologyVersion: {
    hash: "828b3c7d410766cf50d9c334f27ac051008d1bab029b6fb598e71a57bcfdf6d6",
    match: true,
    edgeCount: 167,
    typeCount: 144,
    expectedHash: null,
  },
  evidenceReferences: [],
};
