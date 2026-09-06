import { useCallback, useState } from 'react';
import { EventListScreen } from './EventListScreen';
import { EventSearchScreen } from './EventSearchScreen';
import { ShowVendorScreen } from './ShowVendorScreen';
import type { ShowItem } from '../services/ShowListService';

type ShowsMode = 'list' | 'browse' | 'report';

export function ShowsScreen() {
  const [mode, setMode] = useState<ShowsMode>('list');
  const [selectedShow, setSelectedShow] = useState<ShowItem | null>(null);
  const [reportShow, setReportShow] = useState<ShowItem | null>(null);

  const handleSelectShow = useCallback((show: ShowItem) => {
    setSelectedShow(show);
    setMode('browse');
  }, []);

  const handleReportShow = useCallback((show: ShowItem) => {
    setReportShow(show);
    setMode('report');
  }, []);

  const handleBack = useCallback(() => {
    setSelectedShow(null);
    setReportShow(null);
    setMode('list');
  }, []);

  if (mode === 'browse' && selectedShow) {
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

  if (mode === 'report' && reportShow) {
    return (
      <ShowVendorScreen
        show={reportShow}
        onBack={handleBack}
      />
    );
  }

  return (
    <EventListScreen
      onSelectShow={handleSelectShow}
      onReportShow={handleReportShow}
    />
  );
}
