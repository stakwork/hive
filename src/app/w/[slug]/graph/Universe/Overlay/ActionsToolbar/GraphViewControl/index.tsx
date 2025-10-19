import clsx from 'clsx'
import { ReactElement } from 'react'
import { useShallow } from 'zustand/react/shallow'
import BubbleChartIcon from '@/components/Icons/BubbleChartIcon'
import CommunitiesIcon from '@/components/Icons/CommunitiesIcon'
import GrainIcon from '@/components/Icons/GrainIcon'
import PublicIcon from '@/components/Icons/PublicIcon'
import { GraphStyle, graphStyles, useGraphStore } from '@/stores/useGraphStore'

interface IconsMapper {
  split: ReactElement
  force: ReactElement
  sphere: ReactElement
  earth: ReactElement
}

const IconsMapper = {
  split: <GrainIcon />,
  force: <CommunitiesIcon />,
  sphere: <BubbleChartIcon />,
  earth: <PublicIcon />,
}

export const GraphViewControl = () => {
  const [graphStyle, setGraphStyle] = useGraphStore(useShallow((s) => [s.graphStyle, s.setGraphStyle]))

  const changeGraphType = (val: GraphStyle) => {
    setGraphStyle(val)
  }

  return false ? (
    <div className="w-[447px] h-12 bg-gray-800 rounded-md flex flex-row items-center justify-between">
      {graphStyles.map((i) => (
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
  ) : null
}
