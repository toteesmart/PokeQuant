// Trade state for the scan surface — the evaluator's sides live here (not
// inside the sheet) so "Scan their card" can close the sheet, run the
// camera, and return with the trade intact. handleTradeAdd stays in the
// view: it needs the live `match` and the scan-reset path.
import { useCallback, useState } from 'react';
import type { TradeEntry } from '../scanner/services/deal/tradeEval';

export function useTradeScan() {
  const [tradeOpen, setTradeOpen] = useState(false);
  const [tradeYours, setTradeYours] = useState<TradeEntry[]>([]);
  const [tradeTheirs, setTradeTheirs] = useState<TradeEntry[]>([]);
  const [tradeScanPending, setTradeScanPending] = useState(false);

  const handleTradeScanRequest = useCallback(() => {
    setTradeScanPending(true);
    setTradeOpen(false);
  }, []);

  return {
    tradeOpen,
    setTradeOpen,
    tradeYours,
    setTradeYours,
    tradeTheirs,
    setTradeTheirs,
    tradeScanPending,
    setTradeScanPending,
    handleTradeScanRequest,
  };
}
