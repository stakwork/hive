import { useSchemaStore } from '@/stores/useSchemaStore';
import type { SchemaExtended, SchemaLink } from '@/stores/useSchemaStore';
import type { ActionDetail } from '@Universe/types';

/**
 * Helper to reset the schema store to its initial state
 */
export function resetSchemaStore(): void {
  useSchemaStore.setState({
    schemas: [],
    links: [],
    normalizedSchemasByType: {},
    selectedAction: null,
  });
}

/**
 * Helper to get current store state
 */
export function getSchemaStoreState() {
  return useSchemaStore.getState();
}

/**
 * Factory function to create a minimal schema
 */
export function createTestSchema(
  overrides: Partial<SchemaExtended> = {}
): SchemaExtended {
  return {
    type: 'TestType',
    name: 'Test Schema',
    children: [],
    ...overrides,
  };
}

/**
 * Factory function to create multiple test schemas
 */
export function createTestSchemas(count: number, baseName = 'Type'): SchemaExtended[] {
  return Array.from({ length: count }, (_, i) => ({
    type: `${baseName}${i}`,
    name: `Schema ${i}`,
    children: [],
  }));
}

/**
 * Factory function to create a test link
 */
export function createTestLink(
  overrides: Partial<SchemaLink> = {}
): SchemaLink {
  return {
    edge_type: 'CALLS',
    ref_id: 'test-link-1',
    source: 'src1',
    target: 'tgt1',
    ...overrides,
  };
}

/**
 * Factory function to create multiple test links
 */
export function createTestLinks(count: number): SchemaLink[] {
  return Array.from({ length: count }, (_, i) => ({
    edge_type: 'CALLS',
    ref_id: `link${i}`,
    source: `src${i}`,
    target: `tgt${i}`,
  }));
}

/**
 * Factory function to create a test action detail
 */
export function createTestActionDetail(
  overrides: Partial<ActionDetail> = {}
): ActionDetail {
  return {
    ref_id: 'action1',
    action_type: 'test_action',
    ...overrides,
  } as ActionDetail;
}

/**
 * Helper to set schemas and return the updated state
 */
export function setSchemasAndGetState(schemas: SchemaExtended[]) {
  useSchemaStore.getState().setSchemas(schemas);
  return getSchemaStoreState();
}

/**
 * Helper to set links and return the updated state
 */
export function setLinksAndGetState(links: SchemaLink[]) {
  useSchemaStore.getState().setSchemaLinks(links);
  return getSchemaStoreState();
}

/**
 * Helper to set action detail and return the updated state
 */
export function setActionDetailAndGetState(action: ActionDetail) {
  useSchemaStore.getState().setSelectedActionDetail(action);
  return getSchemaStoreState();
}
