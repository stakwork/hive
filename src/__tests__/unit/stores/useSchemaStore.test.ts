import { describe, it, expect, beforeEach } from 'vitest';
import { useSchemaStore } from '@/stores/useSchemaStore';
import type { SchemaExtended, SchemaLink } from '@/stores/useSchemaStore';
import type { ActionDetail } from '@Universe/types';
import { resetSchemaStore } from '@/__tests__/support/helpers/store-helpers/schema-store';

describe('useSchemaStore', () => {
  // Reset store before each test to ensure isolation
  beforeEach(() => {
    resetSchemaStore();
  });

  describe('Initialization & Default State', () => {
    it('should initialize with empty state', () => {
      const state = useSchemaStore.getState();
      expect(state.schemas).toEqual([]);
      expect(state.links).toEqual([]);
      expect(state.normalizedSchemasByType).toEqual({});
      expect(state.selectedAction).toBeNull();
    });

    it('should have all required methods', () => {
      const state = useSchemaStore.getState();
      expect(typeof state.setSchemas).toBe('function');
      expect(typeof state.setSchemaLinks).toBe('function');
      expect(typeof state.getPrimaryColorByType).toBe('function');
      expect(typeof state.getIndexByType).toBe('function');
      expect(typeof state.getNodeKeysByType).toBe('function');
      expect(typeof state.getSchemaByType).toBe('function');
      expect(typeof state.setSelectedActionDetail).toBe('function');
      expect(typeof state.getSelectedActionDetail).toBe('function');
      expect(typeof state.removeSelectedActionDetail).toBe('function');
    });
  });

  describe('setSchemas', () => {
    it('should set schemas with assigned colors from palette', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Function', name: 'Test Function', children: [] },
        { type: 'Endpoint', name: 'Test Endpoint', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas).toHaveLength(2);
      expect(state.schemas[0]).toHaveProperty('primary_color');
      expect(state.schemas[0]).toHaveProperty('secondary_color');
      expect(state.schemas[1]).toHaveProperty('primary_color');
      expect(state.schemas[1]).toHaveProperty('secondary_color');
    });

    it('should assign colors using palette cycling for schemas without colors', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Type1', name: 'Schema 1', children: [] },
        { type: 'Type2', name: 'Schema 2', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      // First schema gets COLORS_PALETTE[0]
      expect(state.schemas[0].primary_color).toBe('#362429');
      expect(state.schemas[0].secondary_color).toBe('#D25353');

      // Second schema gets COLORS_PALETTE[1]
      expect(state.schemas[1].primary_color).toBe('#38243C');
      expect(state.schemas[1].secondary_color).toBe('#F468D4');
    });

    it('should preserve existing primary_color if it matches palette', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Type1', name: 'Schema 1', primary_color: '#362429', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas[0].primary_color).toBe('#362429');
      expect(state.schemas[0].secondary_color).toBe('#D25353');
    });

    it('should cycle through palette for large arrays', () => {
      const schemas: SchemaExtended[] = Array.from({ length: 15 }, (_, i) => ({
        type: `Type${i}`,
        name: `Schema ${i}`,
        children: [],
      }));

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      // Schema at index 11 should use COLORS_PALETTE[0] again (11 % 11 = 0)
      expect(state.schemas[11].primary_color).toBe('#362429');
      expect(state.schemas[11].secondary_color).toBe('#D25353');

      // Schema at index 12 should use COLORS_PALETTE[1] (12 % 11 = 1)
      expect(state.schemas[12].primary_color).toBe('#38243C');
      expect(state.schemas[12].secondary_color).toBe('#F468D4');
    });

    it('should create normalizedSchemasByType lookup', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Function', name: 'Test Function', children: [] },
        { type: 'Endpoint', name: 'Test Endpoint', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.normalizedSchemasByType['Function']).toBeDefined();
      expect(state.normalizedSchemasByType['Function'].name).toBe('Test Function');
      expect(state.normalizedSchemasByType['Endpoint']).toBeDefined();
      expect(state.normalizedSchemasByType['Endpoint'].name).toBe('Test Endpoint');
    });

    it('should handle empty schemas array', () => {
      useSchemaStore.getState().setSchemas([]);
      const state = useSchemaStore.getState();

      expect(state.schemas).toEqual([]);
      expect(state.normalizedSchemasByType).toEqual({});
    });

    it('should overwrite duplicate types with last occurrence', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Function', name: 'First Function', children: [] },
        { type: 'Function', name: 'Second Function', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas).toHaveLength(2);
      expect(state.normalizedSchemasByType['Function'].name).toBe('Second Function');
    });

    it('should handle schemas with special characters in type', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Type-With-Dashes', name: 'Test', children: [] },
        { type: 'Type_With_Underscores', name: 'Test', children: [] },
        { type: 'Type.With.Dots', name: 'Test', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.normalizedSchemasByType['Type-With-Dashes']).toBeDefined();
      expect(state.normalizedSchemasByType['Type_With_Underscores']).toBeDefined();
      expect(state.normalizedSchemasByType['Type.With.Dots']).toBeDefined();
    });
  });

  describe('setSchemaLinks', () => {
    it('should set schema links', () => {
      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
        { edge_type: 'USES', ref_id: 'link2', source: 'src2', target: 'tgt2' },
      ];

      useSchemaStore.getState().setSchemaLinks(links);
      const state = useSchemaStore.getState();

      expect(state.links).toEqual(links);
      expect(state.links).toHaveLength(2);
    });

    it('should handle empty links array', () => {
      useSchemaStore.getState().setSchemaLinks([]);
      const state = useSchemaStore.getState();

      expect(state.links).toEqual([]);
    });

    it('should replace existing links', () => {
      const initialLinks: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
      ];
      const newLinks: SchemaLink[] = [
        { edge_type: 'USES', ref_id: 'link2', source: 'src2', target: 'tgt2' },
      ];

      useSchemaStore.getState().setSchemaLinks(initialLinks);
      useSchemaStore.getState().setSchemaLinks(newLinks);
      const state = useSchemaStore.getState();

      expect(state.links).toEqual(newLinks);
      expect(state.links).toHaveLength(1);
    });

    it('should handle multiple links with same source or target', () => {
      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
        { edge_type: 'USES', ref_id: 'link2', source: 'src1', target: 'tgt2' },
        { edge_type: 'IMPORTS', ref_id: 'link3', source: 'src2', target: 'tgt1' },
      ];

      useSchemaStore.getState().setSchemaLinks(links);
      const state = useSchemaStore.getState();

      expect(state.links).toHaveLength(3);
      expect(state.links.filter(l => l.source === 'src1')).toHaveLength(2);
      expect(state.links.filter(l => l.target === 'tgt1')).toHaveLength(2);
    });
  });

  describe('getPrimaryColorByType', () => {
    beforeEach(() => {
      const schemas: SchemaExtended[] = [
        { type: 'Function', name: 'Test', primary_color: '#362429', children: [] },
        { type: 'Endpoint', name: 'Test', primary_color: '#38243C', children: [] },
      ];
      useSchemaStore.getState().setSchemas(schemas);
    });

    it('should return primary color for existing type', () => {
      const color = useSchemaStore.getState().getPrimaryColorByType('Function');
      expect(color).toBe('#362429');
    });

    it('should return undefined for non-existing type', () => {
      const color = useSchemaStore.getState().getPrimaryColorByType('NonExistent');
      expect(color).toBeUndefined();
    });

    it('should handle empty string type', () => {
      const color = useSchemaStore.getState().getPrimaryColorByType('');
      expect(color).toBeUndefined();
    });

    it('should return different colors for different types', () => {
      const color1 = useSchemaStore.getState().getPrimaryColorByType('Function');
      const color2 = useSchemaStore.getState().getPrimaryColorByType('Endpoint');
      expect(color1).not.toBe(color2);
    });
  });

  describe('getIndexByType', () => {
    beforeEach(() => {
      const schemas: SchemaExtended[] = [
        { type: 'Function', name: 'Test', index: 'function_name', children: [] },
        { type: 'Endpoint', name: 'Test', children: [] },
      ];
      useSchemaStore.getState().setSchemas(schemas);
    });

    it('should return index property when available', () => {
      const index = useSchemaStore.getState().getIndexByType('Function');
      expect(index).toBe('function_name');
    });

    it('should return undefined when schema exists but index is not available', () => {
      const index = useSchemaStore.getState().getIndexByType('Endpoint');
      expect(index).toBeUndefined();
    });

    it('should return "name" for non-existing type', () => {
      const index = useSchemaStore.getState().getIndexByType('NonExistent');
      expect(index).toBe('name');
    });

    it('should handle empty string type with name fallback', () => {
      const index = useSchemaStore.getState().getIndexByType('');
      expect(index).toBe('name');
    });
  });

  describe('getNodeKeysByType', () => {
    beforeEach(() => {
      const schemas: SchemaExtended[] = [
        { type: 'WithIndex', name: 'Test', index: 'id', children: [] },
        { type: 'WithNodeKey', name: 'Test', node_key: 'key', children: [] },
        { type: 'WithBoth', name: 'Test', index: 'id', node_key: 'key', children: [] },
        { type: 'WithNeither', name: 'Test', children: [] },
      ];
      useSchemaStore.getState().setSchemas(schemas);
    });

    it('should return index when available', () => {
      const key = useSchemaStore.getState().getNodeKeysByType('WithIndex');
      expect(key).toBe('id');
    });

    it('should return node_key when index is not available', () => {
      const key = useSchemaStore.getState().getNodeKeysByType('WithNodeKey');
      expect(key).toBe('key');
    });

    it('should prefer index over node_key when both available', () => {
      const key = useSchemaStore.getState().getNodeKeysByType('WithBoth');
      expect(key).toBe('id');
    });

    it('should return undefined when neither index nor node_key available', () => {
      const key = useSchemaStore.getState().getNodeKeysByType('WithNeither');
      expect(key).toBeUndefined();
    });

    it('should return undefined for non-existing type', () => {
      const key = useSchemaStore.getState().getNodeKeysByType('NonExistent');
      expect(key).toBeUndefined();
    });

    it('should handle empty string type', () => {
      const key = useSchemaStore.getState().getNodeKeysByType('');
      expect(key).toBeUndefined();
    });
  });

  describe('getSchemaByType', () => {
    beforeEach(() => {
      const schemas: SchemaExtended[] = [
        { type: 'Function', name: 'Test Function', description: 'A test', children: [] },
        { type: 'Endpoint', name: 'Test Endpoint', children: [] },
      ];
      useSchemaStore.getState().setSchemas(schemas);
    });

    it('should return schema for existing type', () => {
      const schema = useSchemaStore.getState().getSchemaByType('Function');
      expect(schema).toBeDefined();
      expect(schema?.name).toBe('Test Function');
      expect(schema?.description).toBe('A test');
    });

    it('should return undefined for non-existing type', () => {
      const schema = useSchemaStore.getState().getSchemaByType('NonExistent');
      expect(schema).toBeUndefined();
    });

    it('should return complete schema object with all properties', () => {
      const schema = useSchemaStore.getState().getSchemaByType('Function');
      expect(schema).toHaveProperty('type');
      expect(schema).toHaveProperty('name');
      expect(schema).toHaveProperty('children');
      expect(schema).toHaveProperty('primary_color');
      expect(schema).toHaveProperty('secondary_color');
    });

    it('should handle empty string type', () => {
      const schema = useSchemaStore.getState().getSchemaByType('');
      expect(schema).toBeUndefined();
    });

    it('should return schema with optional properties when present', () => {
      const schemas: SchemaExtended[] = [
        {
          type: 'Complete',
          name: 'Test',
          icon: 'test-icon',
          action: ['action1', 'action2'],
          children: [],
        },
      ];
      useSchemaStore.getState().setSchemas(schemas);

      const schema = useSchemaStore.getState().getSchemaByType('Complete');
      expect(schema?.icon).toBe('test-icon');
      expect(schema?.action).toEqual(['action1', 'action2']);
    });
  });

  describe('Action Detail Management', () => {
    const mockAction: ActionDetail = {
      ref_id: 'action1',
      action_type: 'test_action',
    } as ActionDetail;

    describe('setSelectedActionDetail', () => {
      it('should set selected action', () => {
        useSchemaStore.getState().setSelectedActionDetail(mockAction);
        const state = useSchemaStore.getState();

        expect(state.selectedAction).toEqual(mockAction);
      });

      it('should replace existing selected action', () => {
        const firstAction: ActionDetail = { ...mockAction, ref_id: 'action1' } as ActionDetail;
        const secondAction: ActionDetail = { ...mockAction, ref_id: 'action2' } as ActionDetail;

        useSchemaStore.getState().setSelectedActionDetail(firstAction);
        useSchemaStore.getState().setSelectedActionDetail(secondAction);
        const state = useSchemaStore.getState();

        expect(state.selectedAction).toEqual(secondAction);
        expect(state.selectedAction?.ref_id).toBe('action2');
      });

      it('should handle action with complex properties', () => {
        const complexAction: ActionDetail = {
          ...mockAction,
          ref_id: 'complex1',
          action_type: 'complex_action',
        } as ActionDetail;

        useSchemaStore.getState().setSelectedActionDetail(complexAction);
        const state = useSchemaStore.getState();

        expect(state.selectedAction).toEqual(complexAction);
      });
    });

    describe('getSelectedActionDetail', () => {
      it('should return null when no action is selected', () => {
        const action = useSchemaStore.getState().getSelectedActionDetail();
        expect(action).toBeNull();
      });

      it('should return selected action', () => {
        useSchemaStore.getState().setSelectedActionDetail(mockAction);
        const action = useSchemaStore.getState().getSelectedActionDetail();

        expect(action).toEqual(mockAction);
      });

      it('should return same action on multiple calls', () => {
        useSchemaStore.getState().setSelectedActionDetail(mockAction);
        const action1 = useSchemaStore.getState().getSelectedActionDetail();
        const action2 = useSchemaStore.getState().getSelectedActionDetail();

        expect(action1).toEqual(action2);
      });
    });

    describe('removeSelectedActionDetail', () => {
      it('should clear selected action', () => {
        useSchemaStore.getState().setSelectedActionDetail(mockAction);
        useSchemaStore.getState().removeSelectedActionDetail();
        const state = useSchemaStore.getState();

        expect(state.selectedAction).toBeNull();
      });

      it('should handle removing when no action is set', () => {
        useSchemaStore.getState().removeSelectedActionDetail();
        const state = useSchemaStore.getState();

        expect(state.selectedAction).toBeNull();
      });

      it('should allow setting action after removal', () => {
        useSchemaStore.getState().setSelectedActionDetail(mockAction);
        useSchemaStore.getState().removeSelectedActionDetail();
        useSchemaStore.getState().setSelectedActionDetail(mockAction);
        const state = useSchemaStore.getState();

        expect(state.selectedAction).toEqual(mockAction);
      });
    });
  });

  describe('Edge Cases & Error Handling', () => {
    it('should handle schema with minimal properties', () => {
      const schemas: SchemaExtended[] = [
        { type: 'Minimal', children: [] },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas).toHaveLength(1);
      expect(state.schemas[0].type).toBe('Minimal');
      expect(state.schemas[0]).toHaveProperty('primary_color');
      expect(state.schemas[0]).toHaveProperty('secondary_color');
    });

    it('should handle schema with all optional properties', () => {
      const schemas: SchemaExtended[] = [
        {
          type: 'Complete',
          name: 'Test',
          ref_id: 'ref1',
          age: 5,
          parent: 'parent1',
          link: 'http://test.com',
          icon: 'icon.svg',
          title: 'Title',
          app_version: '1.0.0',
          description: 'Description',
          mission_statement: 'Mission',
          namespace: 'test.namespace',
          search_term: 'search',
          is_deleted: false,
          children: ['child1', 'child2'],
          primary_color: '#FF0000',
          secondary_color: '#00FF00',
          node_key: 'key',
          index: 'id',
          media_url: 'http://media.com',
          image_url: 'http://image.com',
          source_link: 'http://source.com',
          type_description: 'Type desc',
          attributes: { key: 'value', flag: true },
          action: ['action1', 'action2'],
        },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas[0]).toEqual(expect.objectContaining({
        type: 'Complete',
        name: 'Test',
        description: 'Description',
      }));
    });

    it('should handle very large schema arrays', () => {
      const schemas: SchemaExtended[] = Array.from({ length: 1000 }, (_, i) => ({
        type: `Type${i}`,
        name: `Schema ${i}`,
        children: [],
      }));

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas).toHaveLength(1000);
      expect(Object.keys(state.normalizedSchemasByType)).toHaveLength(1000);
    });

    it('should handle multiple rapid updates', () => {
      const schemas1: SchemaExtended[] = [{ type: 'Type1', children: [] }];
      const schemas2: SchemaExtended[] = [{ type: 'Type2', children: [] }];
      const schemas3: SchemaExtended[] = [{ type: 'Type3', children: [] }];

      useSchemaStore.getState().setSchemas(schemas1);
      useSchemaStore.getState().setSchemas(schemas2);
      useSchemaStore.getState().setSchemas(schemas3);

      const state = useSchemaStore.getState();
      expect(state.schemas).toHaveLength(1);
      expect(state.schemas[0].type).toBe('Type3');
    });

    it('should handle schemas with undefined optional properties', () => {
      const schemas: SchemaExtended[] = [
        {
          type: 'Test',
          name: undefined,
          description: undefined,
          children: [],
        },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      const state = useSchemaStore.getState();

      expect(state.schemas).toHaveLength(1);
      expect(state.schemas[0].type).toBe('Test');
      expect(state.schemas[0].name).toBeUndefined();
    });

    it('should handle zero-length links array after having links', () => {
      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
      ];

      useSchemaStore.getState().setSchemaLinks(links);
      useSchemaStore.getState().setSchemaLinks([]);

      const state = useSchemaStore.getState();
      expect(state.links).toEqual([]);
    });
  });

  describe('State Isolation', () => {
    it('should not affect other state properties when updating schemas', () => {
      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
      ];
      const mockAction: ActionDetail = { ref_id: 'action1' } as ActionDetail;

      useSchemaStore.getState().setSchemaLinks(links);
      useSchemaStore.getState().setSelectedActionDetail(mockAction);

      const schemas: SchemaExtended[] = [{ type: 'Function', children: [] }];
      useSchemaStore.getState().setSchemas(schemas);

      const state = useSchemaStore.getState();
      expect(state.links).toEqual(links);
      expect(state.selectedAction).toEqual(mockAction);
    });

    it('should not affect schemas when updating links', () => {
      const schemas: SchemaExtended[] = [{ type: 'Function', children: [] }];
      useSchemaStore.getState().setSchemas(schemas);

      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
      ];
      useSchemaStore.getState().setSchemaLinks(links);

      const state = useSchemaStore.getState();
      expect(state.schemas).toHaveLength(1);
      expect(state.schemas[0].type).toBe('Function');
    });

    it('should not affect other properties when managing action details', () => {
      const schemas: SchemaExtended[] = [{ type: 'Function', children: [] }];
      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
      ];

      useSchemaStore.getState().setSchemas(schemas);
      useSchemaStore.getState().setSchemaLinks(links);

      const mockAction: ActionDetail = { ref_id: 'action1' } as ActionDetail;
      useSchemaStore.getState().setSelectedActionDetail(mockAction);
      useSchemaStore.getState().removeSelectedActionDetail();

      const state = useSchemaStore.getState();
      expect(state.schemas).toHaveLength(1);
      expect(state.links).toEqual(links);
      expect(state.selectedAction).toBeNull();
    });

    it('should handle concurrent operations on different state properties', () => {
      const schemas: SchemaExtended[] = [{ type: 'Type1', children: [] }];
      const links: SchemaLink[] = [
        { edge_type: 'CALLS', ref_id: 'link1', source: 'src1', target: 'tgt1' },
      ];
      const mockAction: ActionDetail = { ref_id: 'action1' } as ActionDetail;

      useSchemaStore.getState().setSchemas(schemas);
      useSchemaStore.getState().setSchemaLinks(links);
      useSchemaStore.getState().setSelectedActionDetail(mockAction);

      const state = useSchemaStore.getState();
      expect(state.schemas).toHaveLength(1);
      expect(state.links).toHaveLength(1);
      expect(state.selectedAction).toEqual(mockAction);
    });

    it('should properly reset all state in beforeEach', () => {
      // Set some state
      const schemas: SchemaExtended[] = [{ type: 'Function', children: [] }];
      useSchemaStore.getState().setSchemas(schemas);

      // Manually trigger reset like beforeEach does
      useSchemaStore.setState({
        schemas: [],
        links: [],
        normalizedSchemasByType: {},
        selectedAction: null,
      });

      const state = useSchemaStore.getState();
      expect(state.schemas).toEqual([]);
      expect(state.links).toEqual([]);
      expect(state.normalizedSchemasByType).toEqual({});
      expect(state.selectedAction).toBeNull();
    });
  });
});
