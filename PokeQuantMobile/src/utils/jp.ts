// Japanese catalog rows are ingested from tcgcsv category 85 with this
// set_name prefix — the marker rides every surface without a schema change.
export const JP_SET_PREFIX = 'JP · ';

export function isJpSetName(setName: string | null | undefined): boolean {
  return typeof setName === 'string' && setName.startsWith(JP_SET_PREFIX);
}
