import { Box3, Group, Sphere, Vector3 } from 'three'

export const calculateRadius = (gr: Group) => {
  const box = new Box3().setFromObject(gr)

  // Check if the bounding box is valid
  if (!box.isEmpty()) {
    const sphere = new Sphere()
    box.getBoundingSphere(sphere)
    return sphere.radius
  }

  // Fallback: calculate radius based on children positions
  // console.log('No valid geometry found, calculating from children positions')

  if (gr.children.length === 0) {
    console.log('No children found, using default radius')
    return 1
  }

  // Find the maximum distance from group center to any child
  const groupCenter = new Vector3()
  let maxDistance = 0

  for (const child of gr.children) {
    const distance = groupCenter.distanceTo(child.position)
    maxDistance = Math.max(maxDistance, distance)
  }

  // Add some padding and ensure minimum radius
  const radius = Math.max(maxDistance * 1.2, 1)
  // console.log(`Calculated radius from children positions: ${radius}`)

  return radius
}
