import { CameraControls } from '@react-three/drei'
import { create } from 'zustand'

type ControlStore = {
  isUserDragging: boolean
  isUserScrolling: boolean
  userMovedCamera: boolean
  userInteractionTime: number | null
  automaticAnimationsDisabled: boolean
  isUserScrollingOnHtmlPanel: boolean
  cameraControlsRef: CameraControls | null
  setIsUserDragging: (isUserDragging: boolean) => void
  setIsUserScrolling: (isUserScrolling: boolean) => void
  setUserMovedCamera: (userMovedCamera: boolean) => void
  setUserInteraction: () => void
  resetAutomaticAnimations: () => void
  setIsUserScrollingOnHtmlPanel: (isUserScrollingOnHtmlPanel: boolean) => void
  setCameraControlsRef: (cameraControlsRef: CameraControls) => void
}

const defaultData: Omit<
  ControlStore,
  | 'setIsUserDragging'
  | 'setIsUserScrolling'
  | 'setUserMovedCamera'
  | 'setUserInteraction'
  | 'resetAutomaticAnimations'
  | 'setIsUserScrollingOnHtmlPanel'
  | 'setCameraControlsRef'
> = {
  isUserDragging: false,
  isUserScrolling: false,
  userMovedCamera: false,
  userInteractionTime: null,
  automaticAnimationsDisabled: false,
  isUserScrollingOnHtmlPanel: false,
  cameraControlsRef: null,
}

let userInteractionTimeout: ReturnType<typeof setTimeout> | null = null

export const useControlStore = create<ControlStore>((set) => ({
  ...defaultData,
  setIsUserDragging: (isUserDragging) => {
    set({ isUserDragging })
  },
  setIsUserScrolling: (isUserScrolling) => {
    set({ isUserScrolling })
  },
  setUserMovedCamera: (userMovedCamera) => {
    set({ userMovedCamera })
  },
  setUserInteraction: () => {
    const now = Date.now()
    set({ userInteractionTime: now, automaticAnimationsDisabled: true })

    // Clear existing timeout
    if (userInteractionTimeout) {
      clearTimeout(userInteractionTimeout)
    }

    // Set 30-second timeout to re-enable automatic animations
    userInteractionTimeout = setTimeout(() => {
      set({ automaticAnimationsDisabled: false })
      console.log('🎬 Automatic camera animations re-enabled after 30 seconds of inactivity')
    }, 30000)

    console.log('🚫 User interaction detected - automatic camera animations disabled for 30 seconds')
  },
  resetAutomaticAnimations: () => {
    if (userInteractionTimeout) {
      clearTimeout(userInteractionTimeout)
      userInteractionTimeout = null
    }
    set({ automaticAnimationsDisabled: false, userInteractionTime: null })
    console.log('🔄 Automatic camera animations reset and re-enabled')
  },
  setIsUserScrollingOnHtmlPanel: (isUserScrollingOnHtmlPanel) => set({ isUserScrollingOnHtmlPanel }),
  setCameraControlsRef: (cameraControlsRef) => set({ cameraControlsRef }),
}))
