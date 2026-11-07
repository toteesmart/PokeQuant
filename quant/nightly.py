"""Nightly quant stamp: one shared price_history pass for snapshot, deep
and ship.

    py -m quant.nightly --src research/pokemon_tcg.db --db pokemon_tcg.db [--pattern]

Same outputs as running, in order,
    py -m quant.snapshot --db SRC
    py -m quant.deep --db SRC --master SRC --per-card [--pattern]
    py -m quant.ship --db DB --src SRC --no-vacuum
but SRC's price_history is streamed once instead of three (four with
--pattern) times. Every series goes to the snapshot hook; its
`market_price > 0` rows go to the deep hooks and, for non-code cards, to
the price_series packer. After the pass: signals_snapshot lands, then
card_deep joins it (set_pctile, archetype), then ship stamps card_signals
and copies the deep tables into DB.

Failure isolation matches the old subprocesses: a snapshot or ship error
exits non-zero and DB's transaction rolls back, so DB keeps the quant
tables it had. A deep error is printed and swallowed: SRC keeps its
previous card_deep / pattern_stats / market_stats and ship copies those.
A per-card error also skips --pattern (the old deep process died before
reaching it); a pattern error leaves card_deep written.
"""
import argparse
import sqlite3
import sys
import traceback
from datetime import date

from quant import deep, ship, snapshot, store


class _DeepHooks:
    """deep's per-card and pattern hooks behind one non-fatal guard."""

    def __init__(self, today, pattern):
        self.per = deep.PerCardPass(today)
        self.pat = deep.PatternPass(today) if pattern else None

    @staticmethod
    def _fail(what):
        traceback.print_exc()
        print(f'deep {what} failed (non-fatal): SRC keeps its previous '
              'deep tables', flush=True)

    def add(self, pid, sub, events):
        if self.per is not None:
            try:
                self.per.add(pid, sub, events)
            except Exception:
                self._fail('--per-card')
                self.per = self.pat = None
                return
        if self.pat is not None:
            try:
                self.pat.add(pid, sub, events)
            except Exception:
                self._fail('--pattern')
                self.pat = None

    def write(self, src_path, master):
        if self.per is None and self.pat is None:
            return
        try:
            con = sqlite3.connect(src_path)
            con.row_factory = sqlite3.Row
        except Exception:
            self._fail('open')
            return
        try:
            if self.per is not None:
                try:
                    self.per.write(con, master)
                except Exception:
                    self._fail('--per-card')
                    self.pat = None
            if self.pat is not None:
                try:
                    self.pat.write(con, master)
                except Exception:
                    self._fail('--pattern')
        finally:
            con.close()


def run(src_path, target_db, today=None, pattern=False, out=None):
    today = today or date.today()
    master = store.open_master(src_path)
    snap = snapshot.SnapshotPass(master, today)
    code_ids = ship.code_card_ids(master)
    hooks = _DeepHooks(today, pattern)

    wcon = sqlite3.connect(target_db)
    # One explicit transaction: price_series is rebuilt during the pass,
    # before signals_snapshot exists, so a later snapshot/ship error must
    # roll the target back to the tables it had.
    wcon.execute('BEGIN')
    try:
        ship.create_price_series(wcon)
        n_ser = 0
        for pid, sub, events in store.iter_series(master):
            snap.add(pid, sub, events)
            pos = store.positive_events(events)
            if not pos:
                continue
            hooks.add(pid, sub, pos)
            if pid not in code_ids:
                n_ser += ship.insert_series(wcon, pid, sub, pos)

        snap.write(src_path, out)
        del snap   # drop the snapshot rows before deep reads them back
        hooks.write(src_path, master)

        n_sig = ship.write_card_signals(wcon, master, code_ids)
        n_deep, n_pat, n_mkt = ship.copy_deep_tables(wcon, master, code_ids)
        wcon.commit()
    except BaseException:
        wcon.rollback()
        raise
    finally:
        wcon.close()
        master.close()
    ship.report(n_sig, n_ser, n_deep, n_pat, n_mkt, target_db)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--src', required=True,
                    help='research DB (snapshot + deep tables written here)')
    ap.add_argument('--db', required=True, help='target catalog DB to stamp')
    ap.add_argument('--pattern', action='store_true',
                    help="also run deep's weekly pattern study")
    ap.add_argument('--out', help='snapshot csv output path')
    args = ap.parse_args()
    try:
        run(args.src, args.db, pattern=args.pattern, out=args.out)
    except RuntimeError as e:
        sys.exit(str(e))


if __name__ == '__main__':
    main()
