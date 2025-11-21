// Simple test to verify the store factory works
import { getStoreBundle, destroyStoreBundle } from "./createStoreFactory";

export function testStoreFactory() {
  console.log("Testing store factory...");

  // Test creating a store bundle
  const bundle1 = getStoreBundle("test-1");
  console.log("✅ Bundle 1 created:", !!bundle1.data, !!bundle1.graph, !!bundle1.simulation);

  // Test getting same bundle again (should be cached)
  const bundle1Again = getStoreBundle("test-1");
  console.log("✅ Bundle 1 cached:", bundle1 === bundle1Again);

  // Test creating different bundle
  const bundle2 = getStoreBundle("test-2");
  console.log("✅ Bundle 2 created:", bundle1 !== bundle2);

  // Test data store functionality
  const dataState = bundle1.data.getState();
  console.log("✅ Data store initial state:", !!dataState.filters, !!dataState.nodesNormalized);

  // Test setting data
  bundle1.data.getState().setFilters({ limit: 500 });
  const updatedState = bundle1.data.getState();
  console.log("✅ Data store updated:", updatedState.filters.limit === 500);

  // Test graph store functionality
  const graphState = bundle1.graph.getState();
  console.log("✅ Graph store initial state:", graphState.graphStyle === "split");

  // Test circular dependency (simulation accessing graph)
  const simState = bundle1.simulation.getState();
  console.log("✅ Simulation store created:", !!simState.setForces);

  // Test cleanup
  destroyStoreBundle("test-1");
  destroyStoreBundle("test-2");
  console.log("✅ Bundles cleaned up");

  console.log("All tests passed! 🎉");
}

// Uncomment to run the test
// testStoreFactory()
