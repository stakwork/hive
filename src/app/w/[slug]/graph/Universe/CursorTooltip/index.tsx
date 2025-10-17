import { useHoveredNode } from '@/stores/useGraphStore'
import { useEffect, useRef } from 'react'
import { HoverCard } from './HoverCard/index'

const CURSOR_SIZE = 70

export const CursorTooltip = () => {
  const tooltipRef = useRef<HTMLDivElement | null>(null)
  const cursorRef = useRef<HTMLDivElement | null>(null)
  const node = useHoveredNode()

  useEffect(() => {
    if (tooltipRef.current) {
      tooltipRef.current.style.display = node ? 'block' : 'none'
    }
  }, [node])

  useEffect(() => {
    const canvasElement = document.getElementById('universe-canvas')
    let animationFrameId: number
    const tooltip = tooltipRef.current
    const cursor = cursorRef.current

    const handleMouseMove = (e: MouseEvent) => {
      if (!tooltip || !cursor) {
        return
      }

      const target = e.target as Element

      if (target.tagName !== 'CANVAS') {
        tooltip.style.display = 'none'
        cursor.style.display = 'none'

        return
      }

      if (canvasElement) {
        canvasElement.style.cursor = 'none'
      }

      cursor.style.display = 'flex'

      tooltip.style.display = 'block' // Ensure tooltip is visible if hovering canvas

      const tooltipWidth = tooltip.offsetWidth
      const tooltipHeight = tooltip.offsetHeight
      const maxX = window.innerWidth - tooltipWidth - 10
      const maxY = window.innerHeight - tooltipHeight - 10

      const x = Math.min(e.clientX + 10, maxX)
      const y = Math.min(e.clientY + 10, maxY)

      animationFrameId = requestAnimationFrame(() => {
        tooltip.style.transform = `translate(${x}px, ${y}px)`
        cursor.style.transform = `translate(${e.clientX - CURSOR_SIZE / 2}px, ${e.clientY - CURSOR_SIZE / 2}px)`
      })
    }

    window.addEventListener('mousemove', handleMouseMove)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <>
      <div
        ref={cursorRef}
        className="pointer-events-none fixed left-0 top-0 w-[70px] h-[70px] flex items-center justify-center border border-white/20 rounded-full bg-black/20"
      >
        <div className="inner-circle flex items-center justify-center rounded-full border border-white/20 relative bg-gradient-radial from-black/40 to-black/10">
          <span className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 text-white/50 text-xl font-extralight -mt-0.5">
            +
          </span>
        </div>
      </div>
      <div
        ref={tooltipRef}
        className="fixed left-0 top-0 text-white pointer-events-none z-[1000] whitespace-nowrap overflow-hidden text-ellipsis hidden shadow-lg"
        style={{ willChange: 'transform' }}
      >
        {node && <HoverCard node={node} />}
      </div>
    </>
  )
}

