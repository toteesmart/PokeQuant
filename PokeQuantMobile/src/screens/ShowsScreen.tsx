import { useCallback, useState } from 'react';
import { EventListScreen } from './EventListScreen';
import { EventSearchScreen } from './EventSearchScreen';
import type { ShowItem } from '../services/ShowListService';

export function ShowsScreen() {
  const [selectedShow, setSelectedShow] = useState<ShowItem | null>(null);

  const handleSelectShow = useCallback((show: ShowItem) => {
    setSelectedShow(show);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedShow(null);
  }, []);

  if (selectedShow) {
    return (
      <EventSearchScreen
        showId={selectedShow.id}
        showName={selectedShow.name}
        showStartDate={selectedShow.startDate}
        showLocation={selectedShow.location}
        onBack={handleBack}
      />
    );
  }

  return <EventListScreen onSelectShow={handleSelectShow} />;
}
