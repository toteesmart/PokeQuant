import { useCallback, useState } from 'react';
import { EventListScreen } from './EventListScreen';
import { EventSearchScreen } from './EventSearchScreen';
import { UPCOMING_SHOWS, type UpcomingShow } from '../constants/shows';

export function ShowsScreen() {
  const [selectedShow, setSelectedShow] = useState<UpcomingShow | null>(null);

  const handleSelectShow = useCallback((show: UpcomingShow) => {
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
        onBack={handleBack}
      />
    );
  }

  return <EventListScreen onSelectShow={handleSelectShow} />;
}
