import BubbleChartIcon from '@/components/Icons/BubbleChartIcon'
import CommunitiesIcon from '@/components/Icons/CommunitiesIcon'
import GrainIcon from '@/components/Icons/GrainIcon'
import { GraphStyle, graphStyles, useGraphStore } from '@/stores/useGraphStore'
import clsx from 'clsx'
import { ReactElement } from 'react'

interface IconsMapper {
  split: ReactElement
  force: ReactElement
  sphere: ReactElement
}

const IconsMapper = {
  split: <GrainIcon />,
  force: <CommunitiesIcon />,
  sphere: <BubbleChartIcon />,
}

export const GraphViewControl = () => {

  const graphStyle = useGraphStore((s) => s.graphStyle)
  const setGraphStyle = useGraphStore((s) => s.setGraphStyle)

  const changeGraphType = (val: GraphStyle) => {
    setGraphStyle(val)
  }

  return (
    <div className="w-[447px] h-12 bg-gray-800 rounded-md flex flex-row items-center justify-between">
      {graphStyles.filter((i) => i !== 'earth').map((i) => (
        <div
          key={i}
          className={clsx(
            'text-gray-400 text-xl cursor-pointer px-5 py-3 hover:text-gray-300 active:text-white transition-colors',
            {
              'text-white bg-blue-600 rounded-md': graphStyle === i
            }
          )}
          onClick={() => changeGraphType(i)}
        >
          {IconsMapper[i]}
        </div>
      ))}
    </div>
  )
}
