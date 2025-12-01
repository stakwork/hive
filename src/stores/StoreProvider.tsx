"use client";

import { createContext, ReactNode, useContext } from 'react';

interface StoreContextType {
  storeId: string
}

const StoreContext = createContext<StoreContextType | null>(null)

interface StoreProviderProps {
  storeId: string
  children: ReactNode
}

export function StoreProvider({ storeId, children }: StoreProviderProps) {
  return (
    <StoreContext.Provider value={{ storeId }}>
      {children}
    </StoreContext.Provider>
  )
}

export function useStoreId(): string {
  const context = useContext(StoreContext)

  if (!context) {
    throw new Error('useStoreId must be used within a StoreProvider')
  }

  return context.storeId
}