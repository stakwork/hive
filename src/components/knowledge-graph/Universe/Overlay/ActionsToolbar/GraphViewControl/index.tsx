import BubbleChartIcon from '@/components/Icons/BubbleChartIcon'
import CommunitiesIcon from '@/components/Icons/CommunitiesIcon'
import GrainIcon from '@/components/Icons/GrainIcon'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GraphStyle, graphStyles, useGraphStore } from '@/stores/useStores'
import { ReactElement } from 'react'

type VisibleGraphStyle = 'split' | 'sphere' // | 'force'

const IconsMapper: Record<VisibleGraphStyle, ReactElement> = {
  split: <GrainIcon />,
  // force: <CommunitiesIcon />,
  sphere: <BubbleChartIcon />,
}

const graphStyleLabels: Record<VisibleGraphStyle, string> = {
  sphere: 'Sphere',
  // force: 'Force',
  split: 'Layered',
}

const styleOrder: VisibleGraphStyle[] = ['split', 'sphere'] // , 'force']

export const GraphViewControl = () => {

  const graphStyle = useGraphStore((s) => s.graphStyle)
  const setGraphStyle = useGraphStore((s) => s.setGraphStyle)

  const changeGraphType = (val: string) => {
    if (val) {
      setGraphStyle(val as GraphStyle)
    }
  }

  return (
    <ToggleGroup
      type="single"
      value={graphStyle}
      onValueChange={changeGraphType}
      variant="outline"
      size="default"
      className="gap-0 bg-background rounded-md"
    >
      {styleOrder.map((style) => (
        <Tooltip key={style}>
          <TooltipTrigger asChild>
            <ToggleGroupItem
              value={style}
              aria-label={graphStyleLabels[style]}
              className="data-[state=on]:bg-accent data-[state=on]:text-accent-foreground px-5"
            >
              <span className="text-xl flex items-center justify-center">
                {IconsMapper[style]}
              </span>
            </ToggleGroupItem>
          </TooltipTrigger>
          <TooltipContent side="top">
            {graphStyleLabels[style]}
          </TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  )
}
