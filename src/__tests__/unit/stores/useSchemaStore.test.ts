import { describe, test, expect, beforeEach } from 'vitest';
import { useSchemaStore, Schema, SchemaLink, SchemaExtended } from '@/stores/useSchemaStore';
import { ActionDetail } from '@Universe/types';

/**
 * Test utilities and mock data factories
 */

// Factory for creating mock schemas
const createMockSchema = (overrides: Partial<SchemaExtended> = {}): SchemaExtended => ({
  type: `type-${Math.random().toString(36).substr(2, 9)}`,
  name: 'Test Schema',
  children: [],
  ...overrides,
});

// Factory for creating mock schema links
const createMockSchemaLink = (overrides: Partial<SchemaLink> = {}): SchemaLink => ({
  edge_type: 'test_edge',
  ref_id: `link-${Math.random().toString(36).substr(2, 9)}`,
  source: 'source-node',
  target: 'target-node',
  ...overrides,
});

// Factory for creating mock action details
const createMockActionDetail = (overrides: Partial<ActionDetail> = {}): ActionDetail => ({
  bounty: false,
  display_name: 'Test Action',
  name: 'test_action',
  workflow_id: 'workflow-123',
  ...overrides,
});

// Helper to inspect store state
const inspectStore = () => {
  const state = useSchemaStore.getState();
  return {
    schemaCount: state.schemas.length,
    linkCount: state.links.length,
    normalizedTypes: Object.keys(state.normalizedSchemasByType),
    selectedAction: state.selectedAction,
  };
};

/**
 * Unit tests for useSchemaStore
 */
describe('useSchemaStore', () => {
  beforeEach(() => {
    // Reset store state before each test by setting empty data
    useSchemaStore.getState().setSchemas([]);
    useSchemaStore.getState().setSchemaLinks([]);
    useSchemaStore.getState().removeSelectedActionDetail();
  });

  describe('setSchemas', () => {
    describe('Basic Functionality', () => {
      test('should set schemas with empty array', () => {
        const { setSchemas } = useSchemaStore.getState();

        setSchemas([]);

        const state = inspectStore();
        expect(state.schemaCount).toBe(0);
        expect(state.normalizedTypes).toHaveLength(0);
      });

      test('should set schemas with single schema', () => {
        const { setSchemas } = useSchemaStore.getState();
        const schema = createMockSchema({ type: 'TestType', name: 'Test Schema' });

        setSchemas([schema]);

        const state = inspectStore();
        expect(state.schemaCount).toBe(1);
        expect(state.normalizedTypes).toContain('TestType');
      });

      test('should set schemas with multiple schemas', () => {
        const { setSchemas } = useSchemaStore.getState();
        const schemas = [
          createMockSchema({ type: 'Type1', name: 'Schema 1' }),
          createMockSchema({ type: 'Type2', name: 'Schema 2' }),
          createMockSchema({ type: 'Type3', name: 'Schema 3' }),
        ];

        setSchemas(schemas);

        const state = inspectStore();
        expect(state.schemaCount).toBe(3);
        expect(state.normalizedTypes).toEqual(['Type1', 'Type2', 'Type3']);
      });

      test('should replace existing schemas', () => {
        const { setSchemas } = useSchemaStore.getState();
        const initialSchemas = [createMockSchema({ type: 'Initial', name: 'Initial' })];
        const newSchemas = [createMockSchema({ type: 'New', name: 'New' })];

        setSchemas(initialSchemas);
        setSchemas(newSchemas);

        const state = inspectStore();
        expect(state.schemaCount).toBe(1);
        expect(state.normalizedTypes).toEqual(['New']);
        expect(state.normalizedTypes).not.toContain('Initial');
      });
    });

    describe('Color Assignment', () => {
      test('should assign colors to schemas without primary_color', () => {
        const { setSchemas } = useSchemaStore.getState();
        const schema = createMockSchema({ type: 'TestType' });
        // Explicitly remove color properties
        delete schema.primary_color;
        delete schema.secondary_color;

        setSchemas([schema]);

        const { schemas } = useSchemaStore.getState();
        expect(schemas[0].primary_color).toBeDefined();
        expect(schemas[0].secondary_color).toBeDefined();
      });

      test('should preserve matching palette colors', () => {
        const { setSchemas } = useSchemaStore.getState();
        // Using color from COLORS_PALETTE: ['#D25353', '#362429']
        const schema = createMockSchema({ 
          type: 'TestType',
          primary_color: '#362429' // This is in the palette
        });

        setSchemas([schema]);

        const { schemas } = useSchemaStore.getState();
        expect(schemas[0].primary_color).toBe('#362429');
        expect(schemas[0].secondary_color).toBe('#D25353'); // Matching pair
      });

      test('should assign new colors when primary_color not in palette', () => {
        const { setSchemas } = useSchemaStore.getState();
        const schema = createMockSchema({ 
          type: 'TestType',
          primary_color: '#FFFFFF' // Not in palette
        });

        setSchemas([schema]);

        const { schemas } = useSchemaStore.getState();
        // Should reassign to palette color
        expect(schemas[0].primary_color).not.toBe('#FFFFFF');
        expect(schemas[0].secondary_color).toBeDefined();
      });

      test('should cycle through color palette for multiple schemas', () => {
        const { setSchemas } = useSchemaStore.getState();
        const schemas = Array(15).fill(null).map((_, i) => 
          createMockSchema({ type: `Type${i}` })
        );

        setSchemas(schemas);

        const { schemas: resultSchemas } = useSchemaStore.getState();
        // All schemas should have colors assigned
        resultSchemas.forEach(schema => {
          expect(schema.primary_color).toBeDefined();
          expect(schema.secondary_color).toBeDefined();
        });

        // Colors should cycle (palette has 11 colors)
        // Schema at index 0 and 11 should have same colors
        expect(resultSchemas[0].primary_color).toBe(resultSchemas[11].primary_color);
        expect(resultSchemas[0].secondary_color).toBe(resultSchemas[11].secondary_color);
      });

      test('should handle schemas with partial color information', () => {
        const { setSchemas } = useSchemaStore.getState();
        const schema = createMockSchema({ 
          type: 'TestType',
          primary_color: '#362429',
          secondary_color: undefined
        });

        setSchemas([schema]);

        const { schemas } = useSchemaStore.getState();
        expect(schemas[0].primary_color).toBeDefined();
        expect(schemas[0].secondary_color).toBeDefined();
      });
    });

    describe('Normalization', () => {
      test('should normalize schemas by type', () => {
        const { setSchemas, getSchemaByType } = useSchemaStore.getState();
        const schemas = [
          createMockSchema({ type: 'Type1', name: 'Schema 1' }),
          createMockSchema({ type: 'Type2', name: 'Schema 2' }),
        ];

        setSchemas(schemas);

        expect(getSchemaByType('Type1')).toBeDefined();
        expect(getSchemaByType('Type1')?.name).toBe('Schema 1');
        expect(getSchemaByType('Type2')).toBeDefined();
        expect(getSchemaByType('Type2')?.name).toBe('Schema 2');
      });

      test('should handle duplicate types (last one wins)', () => {
        const { setSchemas, getSchemaByType } = useSchemaStore.getState();
        const schemas = [
          createMockSchema({ type: 'DuplicateType', name: 'First' }),
          createMockSchema({ type: 'DuplicateType', name: 'Second' }),
        ];

        setSchemas(schemas);

        const result = getSchemaByType('DuplicateType');
        expect(result?.name).toBe('Second');
      });

      test('should normalize schemas with all optional properties', () => {
        const { setSchemas, getSchemaByType } = useSchemaStore.getState();
        const fullSchema = createMockSchema({
          type: 'FullType',
          name: 'Full Schema',
          ref_id: 'ref-123',
          age: 5,
          parent: 'parent-type',
          link: 'https://example.com',
          icon: 'icon.png',
          title: 'Schema Title',
          app_version: '1.0.0',
          description: 'Test description',
          mission_statement: 'Our mission',
          namespace: 'test.namespace',
          search_term: 'searchable',
          is_deleted: false,
          children: ['child1', 'child2'],
          node_key: 'key-123',
          index: 'name',
          media_url: 'https://media.example.com',
          image_url: 'https://image.example.com',
          source_link: 'https://source.example.com',
          type_description: 'Type description',
          attributes: { custom: 'value', enabled: true },
          action: ['action1', 'action2'],
        });

        setSchemas([fullSchema]);

        const result = getSchemaByType('FullType');
        expect(result).toBeDefined();
        expect(result?.name).toBe('Full Schema');
        expect(result?.ref_id).toBe('ref-123');
        expect(result?.children).toEqual(['child1', 'child2']);
        expect(result?.attributes).toEqual({ custom: 'value', enabled: true });
      });
    });

    describe('Schema Immutability', () => {
      test('should create new schema objects (not mutate)', () => {
        const { setSchemas } = useSchemaStore.getState();
        const originalSchema = createMockSchema({ type: 'ImmutableType' });
        const originalColor = originalSchema.primary_color;

        setSchemas([originalSchema]);

        const { schemas } = useSchemaStore.getState();
        // Store should create new objects
        expect(schemas[0]).not.toBe(originalSchema);
        // Original should not be mutated
        expect(originalSchema.primary_color).toBe(originalColor);
      });
    });
  });

  describe('setSchemaLinks', () => {
    test('should set empty links', () => {
      const { setSchemaLinks } = useSchemaStore.getState();

      setSchemaLinks([]);

      const state = inspectStore();
      expect(state.linkCount).toBe(0);
    });

    test('should set single link', () => {
      const { setSchemaLinks } = useSchemaStore.getState();
      const link = createMockSchemaLink({ edge_type: 'parent_of' });

      setSchemaLinks([link]);

      const state = inspectStore();
      expect(state.linkCount).toBe(1);
      expect(useSchemaStore.getState().links[0].edge_type).toBe('parent_of');
    });

    test('should set multiple links', () => {
      const { setSchemaLinks } = useSchemaStore.getState();
      const links = [
        createMockSchemaLink({ edge_type: 'parent_of', source: 'A', target: 'B' }),
        createMockSchemaLink({ edge_type: 'child_of', source: 'B', target: 'C' }),
        createMockSchemaLink({ edge_type: 'related_to', source: 'A', target: 'C' }),
      ];

      setSchemaLinks(links);

      const state = inspectStore();
      expect(state.linkCount).toBe(3);
    });

    test('should replace existing links', () => {
      const { setSchemaLinks } = useSchemaStore.getState();
      const initialLinks = [createMockSchemaLink({ edge_type: 'initial' })];
      const newLinks = [createMockSchemaLink({ edge_type: 'new' })];

      setSchemaLinks(initialLinks);
      setSchemaLinks(newLinks);

      const { links } = useSchemaStore.getState();
      expect(links).toHaveLength(1);
      expect(links[0].edge_type).toBe('new');
    });

    test('should handle links with all properties', () => {
      const { setSchemaLinks } = useSchemaStore.getState();
      const link = createMockSchemaLink({
        edge_type: 'custom_edge',
        ref_id: 'link-ref-123',
        source: 'source-id',
        target: 'target-id',
      });

      setSchemaLinks([link]);

      const { links } = useSchemaStore.getState();
      expect(links[0]).toEqual(link);
    });
  });

  describe('getPrimaryColorByType', () => {
    test('should return primary color for existing type', () => {
      const { setSchemas, getPrimaryColorByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'ColorType',
        primary_color: '#362429'
      });

      setSchemas([schema]);

      const color = getPrimaryColorByType('ColorType');
      expect(color).toBeDefined();
    });

    test('should return undefined for non-existing type', () => {
      const { getPrimaryColorByType } = useSchemaStore.getState();

      const color = getPrimaryColorByType('NonExistingType');

      expect(color).toBeUndefined();
    });

    test('should return correct color when multiple schemas exist', () => {
      const { setSchemas, getPrimaryColorByType } = useSchemaStore.getState();
      const schemas = [
        createMockSchema({ type: 'Type1', primary_color: '#362429' }),
        createMockSchema({ type: 'Type2', primary_color: '#38243C' }),
      ];

      setSchemas(schemas);

      expect(getPrimaryColorByType('Type1')).toBe('#362429');
      expect(getPrimaryColorByType('Type2')).toBe('#38243C');
    });
  });

  describe('getNodeKeysByType', () => {
    test('should return node_key when available', () => {
      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'KeyType',
        node_key: 'custom_key'
      });

      setSchemas([schema]);

      const key = getNodeKeysByType('KeyType');
      expect(key).toBe('custom_key');
    });

    test('should return index when node_key not available', () => {
      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'IndexType',
        index: 'ref_id',
        node_key: undefined
      });

      setSchemas([schema]);

      const key = getNodeKeysByType('IndexType');
      expect(key).toBe('ref_id');
    });

    test('should prioritize index over node_key', () => {
      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'BothType',
        index: 'id_field',
        node_key: 'key_field'
      });

      setSchemas([schema]);

      const key = getNodeKeysByType('BothType');
      expect(key).toBe('id_field');
    });

    test('should return node_key when index is not set but node_key is', () => {
      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'OnlyKeyType',
        node_key: 'only_key',
        index: undefined
      });

      setSchemas([schema]);

      const key = getNodeKeysByType('OnlyKeyType');
      expect(key).toBe('only_key');
    });

    test('should return undefined for non-existing type', () => {
      const { getNodeKeysByType } = useSchemaStore.getState();

      const key = getNodeKeysByType('NonExistingType');

      expect(key).toBeUndefined();
    });

    test('should return undefined when neither index nor node_key exists', () => {
      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'NoKeyType',
        index: undefined,
        node_key: undefined
      });

      setSchemas([schema]);

      const key = getNodeKeysByType('NoKeyType');
      expect(key).toBeUndefined();
    });
  });

  describe('getIndexByType', () => {
    test('should return index when available', () => {
      const { setSchemas, getIndexByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'IndexedType',
        index: 'custom_index'
      });

      setSchemas([schema]);

      const index = getIndexByType('IndexedType');
      expect(index).toBe('custom_index');
    });

    test('should return undefined for existing type without index', () => {
      const { setSchemas, getIndexByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'NoIndexType',
        index: undefined
      });

      setSchemas([schema]);

      const index = getIndexByType('NoIndexType');
      expect(index).toBeUndefined();
    });

    test('should return default "name" for non-existing type', () => {
      const { getIndexByType } = useSchemaStore.getState();

      const index = getIndexByType('NonExistingType');

      expect(index).toBe('name');
    });

    test('should return empty string when index is empty string', () => {
      const { setSchemas, getIndexByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'EmptyIndexType',
        index: ''
      });

      setSchemas([schema]);

      const index = getIndexByType('EmptyIndexType');
      // Returns actual value (empty string), not default 'name'
      expect(index).toBe('');
    });
  });

  describe('getSchemaByType', () => {
    test('should return schema for existing type', () => {
      const { setSchemas, getSchemaByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'GetType',
        name: 'Get Schema'
      });

      setSchemas([schema]);

      const result = getSchemaByType('GetType');
      expect(result).toBeDefined();
      expect(result?.name).toBe('Get Schema');
    });

    test('should return undefined for non-existing type', () => {
      const { getSchemaByType } = useSchemaStore.getState();

      const result = getSchemaByType('NonExisting');

      expect(result).toBeUndefined();
    });

    test('should return complete schema object', () => {
      const { setSchemas, getSchemaByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'CompleteType',
        name: 'Complete',
        ref_id: 'ref-complete',
        children: ['child1'],
        attributes: { key: 'value' }
      });

      setSchemas([schema]);

      const result = getSchemaByType('CompleteType');
      expect(result?.type).toBe('CompleteType');
      expect(result?.name).toBe('Complete');
      expect(result?.ref_id).toBe('ref-complete');
      expect(result?.children).toEqual(['child1']);
      expect(result?.attributes).toEqual({ key: 'value' });
    });

    test('should return updated schema after replacement', () => {
      const { setSchemas, getSchemaByType } = useSchemaStore.getState();
      const schema1 = createMockSchema({ type: 'UpdateType', name: 'Original' });
      const schema2 = createMockSchema({ type: 'UpdateType', name: 'Updated' });

      setSchemas([schema1]);
      expect(getSchemaByType('UpdateType')?.name).toBe('Original');

      setSchemas([schema2]);
      expect(getSchemaByType('UpdateType')?.name).toBe('Updated');
    });
  });

  describe('Selected Action Management', () => {
    describe('setSelectedActionDetail', () => {
      test('should set selected action', () => {
        const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
        const action = createMockActionDetail({ name: 'test_action' });

        setSelectedActionDetail(action);

        const result = getSelectedActionDetail();
        expect(result).toEqual(action);
      });

      test('should replace existing selected action', () => {
        const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
        const action1 = createMockActionDetail({ name: 'action1' });
        const action2 = createMockActionDetail({ name: 'action2' });

        setSelectedActionDetail(action1);
        setSelectedActionDetail(action2);

        const result = getSelectedActionDetail();
        expect(result?.name).toBe('action2');
      });

      test('should set action with all properties', () => {
        const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
        const action = createMockActionDetail({
          bounty: true,
          display_name: 'Test Action Display',
          name: 'test_action_name',
          workflow_id: 'workflow-abc-123',
        });

        setSelectedActionDetail(action);

        const result = getSelectedActionDetail();
        expect(result).toEqual(action);
        expect(result?.bounty).toBe(true);
        expect(result?.display_name).toBe('Test Action Display');
        expect(result?.workflow_id).toBe('workflow-abc-123');
      });
    });

    describe('getSelectedActionDetail', () => {
      test('should return null when no action is selected', () => {
        const { getSelectedActionDetail } = useSchemaStore.getState();

        const result = getSelectedActionDetail();

        expect(result).toBeNull();
      });

      test('should return selected action', () => {
        const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
        const action = createMockActionDetail({ name: 'get_action' });

        setSelectedActionDetail(action);

        const result = getSelectedActionDetail();
        expect(result).toEqual(action);
      });
    });

    describe('removeSelectedActionDetail', () => {
      test('should remove selected action', () => {
        const { setSelectedActionDetail, removeSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
        const action = createMockActionDetail({ name: 'remove_action' });

        setSelectedActionDetail(action);
        expect(getSelectedActionDetail()).toEqual(action);

        removeSelectedActionDetail();

        expect(getSelectedActionDetail()).toBeNull();
      });

      test('should handle removing when no action is selected', () => {
        const { removeSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();

        removeSelectedActionDetail();

        expect(getSelectedActionDetail()).toBeNull();
      });

      test('should allow setting action again after removal', () => {
        const { setSelectedActionDetail, removeSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
        const action1 = createMockActionDetail({ name: 'action1' });
        const action2 = createMockActionDetail({ name: 'action2' });

        setSelectedActionDetail(action1);
        removeSelectedActionDetail();
        setSelectedActionDetail(action2);

        const result = getSelectedActionDetail();
        expect(result?.name).toBe('action2');
      });
    });
  });

  describe('Integration Tests', () => {
    test('should handle complete workflow: set schemas, links, and action', () => {
      const { setSchemas, setSchemaLinks, setSelectedActionDetail, getSchemaByType, getSelectedActionDetail } = useSchemaStore.getState();
      
      const schemas = [
        createMockSchema({ type: 'Type1', name: 'Schema 1' }),
        createMockSchema({ type: 'Type2', name: 'Schema 2' }),
      ];
      const links = [
        createMockSchemaLink({ source: 'Type1', target: 'Type2' }),
      ];
      const action = createMockActionDetail({ name: 'integration_action' });

      setSchemas(schemas);
      setSchemaLinks(links);
      setSelectedActionDetail(action);

      expect(getSchemaByType('Type1')).toBeDefined();
      expect(getSchemaByType('Type2')).toBeDefined();
      expect(useSchemaStore.getState().links).toHaveLength(1);
      expect(getSelectedActionDetail()?.name).toBe('integration_action');
    });

    test('should maintain state independence between schemas, links, and actions', () => {
      const { setSchemas, setSchemaLinks, setSelectedActionDetail, removeSelectedActionDetail } = useSchemaStore.getState();
      
      const schemas = [createMockSchema({ type: 'IndependentType' })];
      const links = [createMockSchemaLink()];
      const action = createMockActionDetail();

      setSchemas(schemas);
      setSchemaLinks(links);
      setSelectedActionDetail(action);

      // Clear only action
      removeSelectedActionDetail();
      
      expect(useSchemaStore.getState().schemas).toHaveLength(1);
      expect(useSchemaStore.getState().links).toHaveLength(1);
      expect(useSchemaStore.getState().selectedAction).toBeNull();

      // Clear only links
      setSchemaLinks([]);
      
      expect(useSchemaStore.getState().schemas).toHaveLength(1);
      expect(useSchemaStore.getState().links).toHaveLength(0);

      // Clear schemas
      setSchemas([]);
      
      expect(useSchemaStore.getState().schemas).toHaveLength(0);
    });

    test('should handle rapid updates to schemas', () => {
      const { setSchemas, getSchemaByType } = useSchemaStore.getState();
      
      // Simulate rapid schema updates
      for (let i = 0; i < 10; i++) {
        const schemas = Array(5).fill(null).map((_, j) => 
          createMockSchema({ type: `Rapid${i}-${j}`, name: `Schema ${i}-${j}` })
        );
        setSchemas(schemas);
      }

      // Should have last batch of schemas
      expect(useSchemaStore.getState().schemas).toHaveLength(5);
      expect(getSchemaByType('Rapid9-0')).toBeDefined();
      expect(getSchemaByType('Rapid0-0')).toBeUndefined(); // Old schemas gone
    });

    test('should handle large dataset', () => {
      const { setSchemas, setSchemaLinks } = useSchemaStore.getState();
      
      const schemas = Array(100).fill(null).map((_, i) => 
        createMockSchema({ type: `LargeType${i}` })
      );
      const links = Array(200).fill(null).map((_, i) => 
        createMockSchemaLink({ 
          source: `LargeType${i % 100}`,
          target: `LargeType${(i + 1) % 100}`
        })
      );

      setSchemas(schemas);
      setSchemaLinks(links);

      expect(useSchemaStore.getState().schemas).toHaveLength(100);
      expect(useSchemaStore.getState().links).toHaveLength(200);
      expect(Object.keys(useSchemaStore.getState().normalizedSchemasByType)).toHaveLength(100);
    });
  });

  describe('Edge Cases', () => {
    test('should handle schema with no type (edge case)', () => {
      const { setSchemas } = useSchemaStore.getState();
      const schema = createMockSchema({ type: '' });

      setSchemas([schema]);

      // Empty type should be normalized
      const { normalizedSchemasByType } = useSchemaStore.getState();
      expect(normalizedSchemasByType['']).toBeDefined();
    });

    test('should handle link with empty strings', () => {
      const { setSchemaLinks } = useSchemaStore.getState();
      const link = createMockSchemaLink({
        edge_type: '',
        source: '',
        target: '',
        ref_id: '',
      });

      setSchemaLinks([link]);

      expect(useSchemaStore.getState().links[0]).toEqual(link);
    });

    test('should handle schema with undefined children', () => {
      const { setSchemas } = useSchemaStore.getState();
      const schema: SchemaExtended = {
        type: 'UndefinedChildren',
        children: [] // SchemaExtended requires children
      };

      setSchemas([schema]);

      const { schemas } = useSchemaStore.getState();
      expect(schemas[0].children).toEqual([]);
    });

    test('should handle schema with null attributes', () => {
      const { setSchemas, getSchemaByType } = useSchemaStore.getState();
      const schema = createMockSchema({ 
        type: 'NullAttrs',
        attributes: null as any
      });

      setSchemas([schema]);

      const result = getSchemaByType('NullAttrs');
      expect(result?.attributes).toBeNull();
    });

    test('should handle action with minimal fields', () => {
      const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState();
      const minimalAction: ActionDetail = {
        bounty: false,
        display_name: '',
        name: '',
        workflow_id: '',
      };

      setSelectedActionDetail(minimalAction);

      expect(getSelectedActionDetail()).toEqual(minimalAction);
    });
  });
});
