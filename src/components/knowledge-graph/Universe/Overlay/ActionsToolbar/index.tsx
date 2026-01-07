import { useDataStore } from '@/stores/useStores'
import { GraphViewControl } from './GraphViewControl'
import { CameraRecenterControl } from './CameraRecenterControl'

export const ActionsToolbar = () => {
    const isOnboarding = useDataStore((s) => s.isOnboarding);

    // Hide controls during onboarding
    if (isOnboarding) {
        return null;
    }

    return (
        <div className="absolute right-5 bottom-5 pointer-events-auto flex flex-col items-end" id="actions-toolbar">
            <div className="flex flex-col gap-1">
                <CameraRecenterControl />
            </div>
            <div className="flex items-center flex-row mt-4">
                <GraphViewControl />
            </div>
        </div>
    )
}
