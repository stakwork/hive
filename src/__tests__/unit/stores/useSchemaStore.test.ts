import { describe, it, expect, beforeEach } from 'vitest'
import { useSchemaStore, SchemaExtended, SchemaLink, Schema } from '@/stores/useSchemaStore'
import { ActionDetail } from '@Universe/types'

describe('useSchemaStore', () => {
  // Reset store state before each test
  beforeEach(() => {
    const { setSchemas, setSchemaLinks, removeSelectedActionDetail } = useSchemaStore.getState()
    setSchemas([])
    setSchemaLinks([])
    removeSelectedActionDetail()
  })

  describe('Store Initialization', () => {
    it('should initialize with empty state', () => {
      const state = useSchemaStore.getState()
      
      expect(state.schemas).toEqual([])
      expect(state.links).toEqual([])
      expect(state.normalizedSchemasByType).toEqual({})
      expect(state.selectedAction).toBeNull()
    })

    it('should provide all expected actions and getters', () => {
      const state = useSchemaStore.getState()
      
      expect(typeof state.setSchemas).toBe('function')
      expect(typeof state.setSchemaLinks).toBe('function')
      expect(typeof state.getPrimaryColorByType).toBe('function')
      expect(typeof state.getIndexByType).toBe('function')
      expect(typeof state.getNodeKeysByType).toBe('function')
      expect(typeof state.getSchemaByType).toBe('function')
      expect(typeof state.setSelectedActionDetail).toBe('function')
      expect(typeof state.getSelectedActionDetail).toBe('function')
      expect(typeof state.removeSelectedActionDetail).toBe('function')
    })
  })

  describe('setSchemas', () => {
    it('should set schemas with color normalization', () => {
      const mockSchemas: SchemaExtended[] = [
        {
          type: 'Person',
          name: 'John Doe',
          ref_id: 'person-1',
          children: [],
        },
        {
          type: 'Organization',
          name: 'Acme Corp',
          ref_id: 'org-1',
          children: [],
        },
      ]

      const { setSchemas } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const state = useSchemaStore.getState()
      expect(state.schemas).toHaveLength(2)
      expect(state.schemas[0].type).toBe('Person')
      expect(state.schemas[1].type).toBe('Organization')
    })

    it('should assign primary and secondary colors from palette when not provided', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
      ]

      const { setSchemas } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const state = useSchemaStore.getState()
      expect(state.schemas[0].primary_color).toBeDefined()
      expect(state.schemas[0].secondary_color).toBeDefined()
      // First schema should get first palette color
      expect(state.schemas[0].primary_color).toBe('#362429')
      expect(state.schemas[0].secondary_color).toBe('#D25353')
    })

    it('should preserve existing primary_color if it matches palette', () => {
      const mockSchemas: SchemaExtended[] = [
        { 
          type: 'Person', 
          name: 'John', 
          ref_id: 'p1', 
          children: [],
          primary_color: '#362429', // Matches palette
        },
      ]

      const { setSchemas } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const state = useSchemaStore.getState()
      expect(state.schemas[0].primary_color).toBe('#362429')
      expect(state.schemas[0].secondary_color).toBe('#D25353')
    })

    it('should cycle through color palette for multiple schemas', () => {
      const mockSchemas: SchemaExtended[] = Array.from({ length: 15 }, (_, i) => ({
        type: `Type${i}`,
        name: `Schema ${i}`,
        ref_id: `schema-${i}`,
        children: [],
      }))

      const { setSchemas } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const state = useSchemaStore.getState()
      expect(state.schemas).toHaveLength(15)
      
      // Verify cycling: schema[0] and schema[11] should have same colors
      expect(state.schemas[0].primary_color).toBe(state.schemas[11].primary_color)
      expect(state.schemas[0].secondary_color).toBe(state.schemas[11].secondary_color)
      
      // Verify different colors for consecutive schemas
      expect(state.schemas[0].primary_color).not.toBe(state.schemas[1].primary_color)
    })

    it('should create normalized schemas by type', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
        { type: 'Organization', name: 'Acme', ref_id: 'o1', children: [] },
        { type: 'Project', name: 'ProjectX', ref_id: 'pr1', children: [] },
      ]

      const { setSchemas } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const state = useSchemaStore.getState()
      expect(Object.keys(state.normalizedSchemasByType)).toHaveLength(3)
      expect(state.normalizedSchemasByType['Person']).toBeDefined()
      expect(state.normalizedSchemasByType['Organization']).toBeDefined()
      expect(state.normalizedSchemasByType['Project']).toBeDefined()
      expect(state.normalizedSchemasByType['Person'].name).toBe('John')
    })

    it('should handle duplicate types by keeping the last occurrence', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
        { type: 'Person', name: 'Jane', ref_id: 'p2', children: [] },
      ]

      const { setSchemas } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const state = useSchemaStore.getState()
      expect(Object.keys(state.normalizedSchemasByType)).toHaveLength(1)
      expect(state.normalizedSchemasByType['Person'].name).toBe('Jane')
      expect(state.normalizedSchemasByType['Person'].ref_id).toBe('p2')
    })

    it('should handle empty schemas array', () => {
      const { setSchemas } = useSchemaStore.getState()
      setSchemas([])

      const state = useSchemaStore.getState()
      expect(state.schemas).toEqual([])
      expect(state.normalizedSchemasByType).toEqual({})
    })

    it('should handle schemas with all optional properties', () => {
      const mockSchema: SchemaExtended = {
        type: 'ComplexType',
        name: 'Complex Schema',
        ref_id: 'complex-1',
        age: 30,
        parent: 'parent-1',
        link: 'https://example.com',
        icon: 'icon-url',
        title: 'Schema Title',
        app_version: '1.0.0',
        description: 'Schema description',
        mission_statement: 'Mission',
        namespace: 'app.schemas',
        search_term: 'complex',
        is_deleted: false,
        children: ['child-1', 'child-2'],
        primary_color: '#FF0000',
        secondary_color: '#00FF00',
        node_key: 'ref_id',
        index: 'name',
        media_url: 'media.jpg',
        image_url: 'image.jpg',
        source_link: 'source.com',
        type_description: 'Type desc',
        attributes: { key1: 'value1', key2: true },
        action: ['action1', 'action2'],
      }

      const { setSchemas } = useSchemaStore.getState()
      setSchemas([mockSchema])

      const state = useSchemaStore.getState()
      // Note: setSchemas assigns colors from COLORS_PALETTE, so we don't check color fields
      const { primary_color, secondary_color, ...schemaWithoutColors } = mockSchema
      expect(state.schemas[0]).toMatchObject(schemaWithoutColors)
      // Verify colors were assigned
      expect(state.schemas[0].primary_color).toBeDefined()
      expect(state.schemas[0].secondary_color).toBeDefined()
    })
  })

  describe('setSchemaLinks', () => {
    it('should set schema links', () => {
      const mockLinks: SchemaLink[] = [
        {
          edge_type: 'CONNECTS_TO',
          ref_id: 'link-1',
          source: 'node-1',
          target: 'node-2',
        },
        {
          edge_type: 'BELONGS_TO',
          ref_id: 'link-2',
          source: 'node-2',
          target: 'node-3',
        },
      ]

      const { setSchemaLinks } = useSchemaStore.getState()
      setSchemaLinks(mockLinks)

      const state = useSchemaStore.getState()
      expect(state.links).toHaveLength(2)
      expect(state.links[0].edge_type).toBe('CONNECTS_TO')
      expect(state.links[1].edge_type).toBe('BELONGS_TO')
    })

    it('should handle empty links array', () => {
      const { setSchemaLinks } = useSchemaStore.getState()
      setSchemaLinks([])

      const state = useSchemaStore.getState()
      expect(state.links).toEqual([])
    })

    it('should replace existing links', () => {
      const { setSchemaLinks } = useSchemaStore.getState()
      
      const firstLinks: SchemaLink[] = [
        { edge_type: 'TYPE1', ref_id: 'l1', source: 's1', target: 't1' },
      ]
      setSchemaLinks(firstLinks)
      
      const secondLinks: SchemaLink[] = [
        { edge_type: 'TYPE2', ref_id: 'l2', source: 's2', target: 't2' },
        { edge_type: 'TYPE3', ref_id: 'l3', source: 's3', target: 't3' },
      ]
      setSchemaLinks(secondLinks)

      const state = useSchemaStore.getState()
      expect(state.links).toHaveLength(2)
      expect(state.links[0].edge_type).toBe('TYPE2')
    })
  })

  describe('getPrimaryColorByType', () => {
    it('should return primary color for existing schema type', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
      ]

      const { setSchemas, getPrimaryColorByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const color = getPrimaryColorByType('Person')
      expect(color).toBeDefined()
      expect(typeof color).toBe('string')
    })

    it('should return undefined for non-existent schema type', () => {
      const { getPrimaryColorByType } = useSchemaStore.getState()
      
      const color = getPrimaryColorByType('NonExistentType')
      expect(color).toBeUndefined()
    })

    it('should return correct color after schema update', () => {
      const { setSchemas, getPrimaryColorByType } = useSchemaStore.getState()
      
      const firstSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [], primary_color: '#362429' },
      ]
      setSchemas(firstSchemas)
      
      const color = getPrimaryColorByType('Person')
      expect(color).toBe('#362429')
    })
  })

  describe('getIndexByType', () => {
    it('should return index property if defined', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [], index: 'custom_id' },
      ]

      const { setSchemas, getIndexByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const index = getIndexByType('Person')
      expect(index).toBe('custom_id')
    })

    it('should return undefined if schema exists but index not defined', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
      ]

      const { setSchemas, getIndexByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const index = getIndexByType('Person')
      expect(index).toBeUndefined()
    })

    it('should return "name" for non-existent schema type', () => {
      const { getIndexByType } = useSchemaStore.getState()
      
      const index = getIndexByType('NonExistentType')
      expect(index).toBe('name')
    })
  })

  describe('getNodeKeysByType', () => {
    it('should return index property if defined', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [], index: 'custom_id' },
      ]

      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const nodeKey = getNodeKeysByType('Person')
      expect(nodeKey).toBe('custom_id')
    })

    it('should return node_key if index not defined but node_key exists', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [], node_key: 'node_identifier' },
      ]

      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const nodeKey = getNodeKeysByType('Person')
      expect(nodeKey).toBe('node_identifier')
    })

    it('should prioritize index over node_key', () => {
      const mockSchemas: SchemaExtended[] = [
        { 
          type: 'Person', 
          name: 'John', 
          ref_id: 'p1', 
          children: [], 
          index: 'custom_index',
          node_key: 'node_identifier',
        },
      ]

      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const nodeKey = getNodeKeysByType('Person')
      expect(nodeKey).toBe('custom_index')
    })

    it('should return undefined for non-existent schema type', () => {
      const { getNodeKeysByType } = useSchemaStore.getState()
      
      const nodeKey = getNodeKeysByType('NonExistentType')
      expect(nodeKey).toBeUndefined()
    })

    it('should return undefined if neither index nor node_key defined', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
      ]

      const { setSchemas, getNodeKeysByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const nodeKey = getNodeKeysByType('Person')
      expect(nodeKey).toBeUndefined()
    })
  })

  describe('getSchemaByType', () => {
    it('should return schema for existing type', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John Doe', ref_id: 'p1', children: [] },
        { type: 'Organization', name: 'Acme Corp', ref_id: 'o1', children: [] },
      ]

      const { setSchemas, getSchemaByType } = useSchemaStore.getState()
      setSchemas(mockSchemas)

      const schema = getSchemaByType('Person')
      expect(schema).toBeDefined()
      expect(schema?.type).toBe('Person')
      expect(schema?.name).toBe('John Doe')
      expect(schema?.ref_id).toBe('p1')
    })

    it('should return undefined for non-existent type', () => {
      const { getSchemaByType } = useSchemaStore.getState()
      
      const schema = getSchemaByType('NonExistentType')
      expect(schema).toBeUndefined()
    })

    it('should return updated schema after setSchemas', () => {
      const { setSchemas, getSchemaByType } = useSchemaStore.getState()
      
      const firstSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
      ]
      setSchemas(firstSchemas)
      
      const secondSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'Jane', ref_id: 'p2', children: [] },
      ]
      setSchemas(secondSchemas)

      const schema = getSchemaByType('Person')
      expect(schema?.name).toBe('Jane')
      expect(schema?.ref_id).toBe('p2')
    })
  })

  describe('Selected Action Detail Management', () => {
    it('should set selected action detail', () => {
      const mockAction: ActionDetail = {
        action: 'create_task',
        label: 'Create Task',
        icon: 'task-icon',
        description: 'Create a new task',
      } as ActionDetail

      const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState()
      setSelectedActionDetail(mockAction)

      const action = getSelectedActionDetail()
      expect(action).toEqual(mockAction)
      expect(action?.action).toBe('create_task')
    })

    it('should get selected action detail', () => {
      const mockAction: ActionDetail = {
        action: 'edit_node',
        label: 'Edit Node',
      } as ActionDetail

      const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState()
      setSelectedActionDetail(mockAction)

      const state = useSchemaStore.getState()
      expect(state.selectedAction).toEqual(mockAction)
      expect(getSelectedActionDetail()).toEqual(mockAction)
    })

    it('should return null when no action is selected', () => {
      const { getSelectedActionDetail } = useSchemaStore.getState()
      
      const action = getSelectedActionDetail()
      expect(action).toBeNull()
    })

    it('should remove selected action detail', () => {
      const mockAction: ActionDetail = {
        action: 'delete_node',
        label: 'Delete Node',
      } as ActionDetail

      const { setSelectedActionDetail, removeSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState()
      
      setSelectedActionDetail(mockAction)
      expect(getSelectedActionDetail()).toEqual(mockAction)
      
      removeSelectedActionDetail()
      expect(getSelectedActionDetail()).toBeNull()
    })

    it('should replace existing selected action', () => {
      const firstAction: ActionDetail = {
        action: 'action1',
        label: 'Action 1',
      } as ActionDetail

      const secondAction: ActionDetail = {
        action: 'action2',
        label: 'Action 2',
      } as ActionDetail

      const { setSelectedActionDetail, getSelectedActionDetail } = useSchemaStore.getState()
      
      setSelectedActionDetail(firstAction)
      expect(getSelectedActionDetail()?.action).toBe('action1')
      
      setSelectedActionDetail(secondAction)
      expect(getSelectedActionDetail()?.action).toBe('action2')
    })
  })

  describe('Edge Cases and Integration', () => {
    it('should handle complete workflow: set schemas, links, and action', () => {
      const mockSchemas: SchemaExtended[] = [
        { type: 'Person', name: 'John', ref_id: 'p1', children: [] },
        { type: 'Organization', name: 'Acme', ref_id: 'o1', children: [] },
      ]

      const mockLinks: SchemaLink[] = [
        { edge_type: 'WORKS_AT', ref_id: 'l1', source: 'p1', target: 'o1' },
      ]

      const mockAction: ActionDetail = {
        action: 'view_details',
        label: 'View Details',
      } as ActionDetail

      const { 
        setSchemas, 
        setSchemaLinks, 
        setSelectedActionDetail,
        getPrimaryColorByType,
        getSchemaByType,
      } = useSchemaStore.getState()

      setSchemas(mockSchemas)
      setSchemaLinks(mockLinks)
      setSelectedActionDetail(mockAction)

      const state = useSchemaStore.getState()
      expect(state.schemas).toHaveLength(2)
      expect(state.links).toHaveLength(1)
      expect(state.selectedAction).toEqual(mockAction)
      expect(getPrimaryColorByType('Person')).toBeDefined()
      expect(getSchemaByType('Organization')).toBeDefined()
    })

    it('should maintain state independence between schemas and links', () => {
      const { setSchemas, setSchemaLinks } = useSchemaStore.getState()
      
      const mockSchemas: SchemaExtended[] = [
        { type: 'Type1', name: 'Schema1', ref_id: 's1', children: [] },
      ]
      setSchemas(mockSchemas)

      const stateAfterSchemas = useSchemaStore.getState()
      expect(stateAfterSchemas.schemas).toHaveLength(1)
      expect(stateAfterSchemas.links).toHaveLength(0)

      const mockLinks: SchemaLink[] = [
        { edge_type: 'EDGE', ref_id: 'l1', source: 's1', target: 's2' },
      ]
      setSchemaLinks(mockLinks)

      const stateAfterLinks = useSchemaStore.getState()
      expect(stateAfterLinks.schemas).toHaveLength(1)
      expect(stateAfterLinks.links).toHaveLength(1)
    })

    it('should handle schemas with missing required children property', () => {
      const schemaWithoutChildren = {
        type: 'Person',
        name: 'John',
        ref_id: 'p1',
      } as SchemaExtended

      const { setSchemas } = useSchemaStore.getState()
      setSchemas([schemaWithoutChildren])

      const state = useSchemaStore.getState()
      expect(state.schemas).toHaveLength(1)
      expect(state.schemas[0].type).toBe('Person')
    })

    it('should handle rapid state updates', () => {
      const { setSchemas } = useSchemaStore.getState()
      
      for (let i = 0; i < 10; i++) {
        const schemas: SchemaExtended[] = [
          { type: `Type${i}`, name: `Schema${i}`, ref_id: `s${i}`, children: [] },
        ]
        setSchemas(schemas)
      }

      const state = useSchemaStore.getState()
      expect(state.schemas).toHaveLength(1)
      expect(state.schemas[0].type).toBe('Type9')
    })

    it('should handle large schema datasets', () => {
      const largeSchemaSet: SchemaExtended[] = Array.from({ length: 100 }, (_, i) => ({
        type: `Type${i}`,
        name: `Schema ${i}`,
        ref_id: `schema-${i}`,
        children: [`child-${i}-1`, `child-${i}-2`],
      }))

      const { setSchemas, getPrimaryColorByType } = useSchemaStore.getState()
      setSchemas(largeSchemaSet)

      const state = useSchemaStore.getState()
      expect(state.schemas).toHaveLength(100)
      expect(Object.keys(state.normalizedSchemasByType)).toHaveLength(100)
      expect(getPrimaryColorByType('Type50')).toBeDefined()
    })
  })
})
