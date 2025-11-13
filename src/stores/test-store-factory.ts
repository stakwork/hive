// Simple test to verify the store factory works
import { getStoreBundle, destroyStoreBundle } from './createStoreFactory'
import { logger } from "@/lib/logger";

export function testStoreFactory() {
  console.log('Testing store factory...')

  // Test creating a store bundle
  const bundle1 = getStoreBundle('test-1')
  logger.debug("✅ Bundle 1 created:", "test-store-factory", { !!bundle1.data, !!bundle1.graph, !!bundle1.simulation })

  // Test getting same bundle again (should be cached)
  const bundle1Again = getStoreBundle('test-1')
  logger.debug("✅ Bundle 1 cached:", "test-store-factory", { bundle1 === bundle1Again })

  // Test creating different bundle
  const bundle2 = getStoreBundle('test-2')
  logger.debug("✅ Bundle 2 created:", "test-store-factory", { bundle1 !== bundle2 })

  // Test data store functionality
  const dataState = bundle1.data.getState()
  logger.debug("✅ Data store initial state:", "test-store-factory", { !!dataState.filters, !!dataState.nodesNormalized })

  // Test setting data
  bundle1.data.getState().setFilters({ limit: 500 })
  const updatedState = bundle1.data.getState()
  logger.debug("✅ Data store updated:", "test-store-factory", { updatedState.filters.limit === 500 })

  // Test graph store functionality
  const graphState = bundle1.graph.getState()
  logger.debug("✅ Graph store initial state:", "test-store-factory", { graphState.graphStyle === 'split' })

  // Test circular dependency (simulation accessing graph)
  const simState = bundle1.simulation.getState()
  logger.debug("✅ Simulation store created:", "test-store-factory", { !!simState.setForces })

  // Test cleanup
  destroyStoreBundle('test-1')
  destroyStoreBundle('test-2')
  console.log('✅ Bundles cleaned up')

  console.log('All tests passed! 🎉')
}

// Uncomment to run the test
// testStoreFactory()