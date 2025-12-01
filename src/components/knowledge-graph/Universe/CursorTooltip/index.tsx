import { useHoveredNode } from '@/stores/useStores'
import { useEffect, useRef } from 'react'
import { HoverCard } from './HoverCard/index'


export const CursorTooltip = () => {
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const node = useHoveredNode()

  useEffect(() => {
    if (tooltipRef.current) {
      tooltipRef.current.style.display = node ? 'block' : 'none'
    }
  }, [node])

  useEffect(() => {
    let animationFrameId: number
    const tooltip = tooltipRef.current

    const handleMouseMove = (e: MouseEvent) => {
      if (!tooltip) {
        return
      }

      const target = e.target as Element

      if (target.tagName !== 'CANVAS') {
        tooltip.style.display = 'none'
        return
      }

      tooltip.style.display = 'block' // Ensure tooltip is visible if hovering canvas

      const tooltipWidth = tooltip.offsetWidth
      const tooltipHeight = tooltip.offsetHeight
      const maxX = window.innerWidth - tooltipWidth - 10
      const maxY = window.innerHeight - tooltipHeight - 10

      const x = Math.min(e.clientX + 10, maxX)
      const y = Math.min(e.clientY + 10, maxY)

      animationFrameId = requestAnimationFrame(() => {
        tooltip.style.transform = `translate(${x}px, ${y}px)`
      })
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div
      ref={tooltipRef}
      className="fixed left-0 top-0 text-white pointer-events-none z-[1000] whitespace-nowrap overflow-hidden text-ellipsis hidden shadow-lg"
      style={{ willChange: 'transform' }}
    >
      {node && <HoverCard node={node} />}
    </div>
  )
}

