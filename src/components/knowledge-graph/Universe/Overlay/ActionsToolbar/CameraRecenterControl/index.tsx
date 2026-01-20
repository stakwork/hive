import React from 'react'
import CameraCenterIcon from '@/components/Icons/CameraCenterIcon'
import { useGraphStore } from '@/stores/useStores'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export const CameraRecenterControl = () => {
  const cameraFocusTrigger = useGraphStore((s) => s.cameraFocusTrigger)
  const setCameraFocusTrigger = useGraphStore((s) => s.setCameraFocusTrigger)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => setCameraFocusTrigger(!cameraFocusTrigger)}
          className="p-0 w-10 h-10 min-w-0 flex justify-center items-center pointer-events-auto bg-transparent border-none cursor-pointer hover:bg-black/10 rounded transition-colors"
        >
          <div className="brightness-[0.65]">
            <CameraCenterIcon />
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <p>Recenter</p>
      </TooltipContent>
    </Tooltip>
  )
}
