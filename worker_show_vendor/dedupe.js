// Dedupe identity keys for public_show_inventory rows. Rows that carry a real
// TCGplayer id key off it ("p:<id>"); rows without one key off
// "n:<name>|<set>|<number>"; fully-empty keys fall back to a random "n:row:*"
// so they cannot collide under the unique index.

function toLowerAsciiOnly(text) {
  return String(text || "").replace(/[A-Z]/g, (ch) => ch.toLowerCase());
}

export function buildDedupeKey(productId, name, setName, number) {
  if (productId > 0) {
    return `p:${productId}`;
  }
  const n = toLowerAsciiOnly(String(name || ""));
  const s = toLowerAsciiOnly(String(setName || ""));
  const num = toLowerAsciiOnly(String(number || ""));
  if (n === "" && s === "" && num === "") {
    return `n:row:${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  }
  return `n:${n}|${s}|${num}`;
}
