import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

type TourContextValue = {
  /** Text currently visible in the Search & Buy input when the tour is active. */
  tourSearchInput: string;
  /** Set the simulated search input text (visible in the search bar). */
  setTourSearchInput: (query: string) => void;
  /** Effective filter query applied to the Search & Buy catalog. */
  tourSearchFilter: string;
  /** Set the filter query applied to the catalog. */
  setTourSearchFilter: (query: string) => void;
  /** Whether the simulated typing animation is still running. */
  tourSearchTyping: boolean;
  /** Set whether the tour is currently simulating typing. */
  setTourSearchTyping: (typing: boolean) => void;
  /** Simulated Add Asset tray open state injected by the onboarding tour. */
  tourAddAssetOpen: boolean;
  /** Set the simulated Add Asset tray open state. */
  setTourAddAssetOpen: (open: boolean) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: ReactNode }) {
  const [tourSearchInput, setTourSearchInput] = useState('');
  const [tourSearchFilter, setTourSearchFilter] = useState('');
  const [tourSearchTyping, setTourSearchTyping] = useState(false);
  const [tourAddAssetOpen, setTourAddAssetOpen] = useState(false);

  return (
    <TourContext.Provider
      value={{
        tourSearchInput,
        setTourSearchInput,
        tourSearchFilter,
        setTourSearchFilter,
        tourSearchTyping,
        setTourSearchTyping,
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
