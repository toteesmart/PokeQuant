import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

type TourContextValue = {
  /** Simulated search query injected by the onboarding tour. */
  tourSearchQuery: string;
  /** Set the simulated search query; empty clears it. */
  setTourSearchQuery: (query: string) => void;
  /** Simulated Add Asset tray open state injected by the onboarding tour. */
  tourAddAssetOpen: boolean;
  /** Set the simulated Add Asset tray open state. */
  setTourAddAssetOpen: (open: boolean) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [tourSearchQuery, setTourSearchQuery] = useState('');
  const [tourAddAssetOpen, setTourAddAssetOpen] = useState(false);

  return (
    <TourContext.Provider
      value={{
        tourSearchQuery,
        setTourSearchQuery,
        tourAddAssetOpen,
        setTourAddAssetOpen,
      }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour() {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error('useTour must be used within a TourProvider');
  }
  return context;
}
