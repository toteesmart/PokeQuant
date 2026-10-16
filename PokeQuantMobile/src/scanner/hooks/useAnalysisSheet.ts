// Shared "name tap → deal analysis" plumbing: resolve a CardRef into a
// CatalogMatch and open the DealAnalysisSheet on it. Lives in scanner/
// because the sheet + deal module are scanner-owned; app screens import it.
//
// Failed matches drop silently — the sheet simply never opens.
// `setAnalysisFor` is exposed for callers that already hold a resolved
// CatalogMatch (e.g. the scanner's own confirmed match).

import { useCallback, useState } from 'react';
import { matchForCardRef, type CardRef } from '../services/catalog/ScannerCatalogProvider';
import type { CatalogMatch } from '../services/catalog/catalogMatcher';
import type { DealOwnership } from '../molecules/DealReadSection';

type AnalysisTarget = {
  match: CatalogMatch;
  subType?: string;
  ownership?: DealOwnership;
};

export function useAnalysisSheet() {
  const [analysisFor, setAnalysisFor] = useState<AnalysisTarget | null>(null);

  const openAnalysis = useCallback((ref: CardRef, subType?: string, ownership?: DealOwnership) => {
    void matchForCardRef(ref)
      .then((m) => setAnalysisFor({ match: m, subType, ownership }))
      .catch(() => {});
  }, []);

  const closeAnalysis = useCallback(() => setAnalysisFor(null), []);

  return { analysisFor, setAnalysisFor, openAnalysis, closeAnalysis };
}
