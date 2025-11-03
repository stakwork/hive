import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from "three";

/**
 * Creates a Three.js Mesh with BoxGeometry and MeshBasicMaterial
 * @param width - Box width
 * @param height - Box height
 * @param depth - Box depth
 * @param position - Optional position [x, y, z]
 */
export function createBox(
  width: number,
  height: number,
  depth: number,
  position?: [number, number, number]
): Mesh {
  const mesh = new Mesh(new BoxGeometry(width, height, depth), new MeshBasicMaterial());
  if (position) {
    mesh.position.set(...position);
  }
  return mesh;
}

/**
 * Creates a Three.js Group with the given meshes
 * @param meshes - Meshes to add to the group
 */
export function createGroupWithMeshes(...meshes: Mesh[]): Group {
  const group = new Group();
  group.add(...meshes);
  return group;
}
