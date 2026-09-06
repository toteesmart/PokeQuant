// Cloudflare Worker: pre-show event catalog generator
// Trigger: cron (hourly). Queries Turso public_show_inventory, writes a
// sanitized JSON array, zips it with raw deflate, and uploads to R2.

const SHOWS_QUERY = `SELECT id, vendor_id, name, start_date, location, is_active FROM shows WHERE is_active = 1`;

const INVENTORY_QUERY = `
  SELECT
    id,
    product_id,
    name,
    set_name,
    number,
    rarity,
    condition,
    sticker_price,
    quantity,
    vendor_name,
    vendor_table
  FROM public_show_inventory
  WHERE show_id = ?
`;

const ZIP_FILENAME = 'event_catalog.json';

let crcTable = null;

function makeCrcTable() {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    t[i] = c >>> 0;
  }
  crcTable = t;
  return t;
}

function crc32(data) {
  const table = makeCrcTable();
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = (table[(c ^ data[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dateToDos(d) {
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hour = d.getHours();
  const minute = d.getMinutes();
  const second = d.getSeconds();
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  const dosTime = (hour << 11) | (minute << 5) | (second >> 1);
  return { dosDate, dosTime };
}

function writeUint32LE(value) {
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ];
}

function writeUint16LE(value) {
  return [value & 0xff, (value >> 8) & 0xff];
}

function concatArrays(arrays) {
  let total = 0;
  for (const a of arrays) total += a.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

async function deflateRaw(data) {
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
  const compressed = input.pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

async function buildZip(filename, rawData) {
  const encoder = new TextEncoder();
  const filenameBytes = encoder.encode(filename);
  const compressed = await deflateRaw(rawData);
  const checksum = crc32(rawData);
  const { dosDate, dosTime } = dateToDos(new Date());

  const localHeader = new Uint8Array([
    ...writeUint32LE(0x04034b50),
    ...writeUint16LE(20),
    ...writeUint16LE(0),
    ...writeUint16LE(8),
    ...writeUint16LE(dosTime),
    ...writeUint16LE(dosDate),
    ...writeUint32LE(checksum),
    ...writeUint32LE(compressed.length),
    ...writeUint32LE(rawData.length),
    ...writeUint16LE(filenameBytes.length),
    ...writeUint16LE(0),
    ...filenameBytes,
  ]);

  const centralHeader = new Uint8Array([
    ...writeUint32LE(0x02014b50),
    ...writeUint16LE(0x031e),
    ...writeUint16LE(20),
    ...writeUint16LE(0),
    ...writeUint16LE(8),
    ...writeUint16LE(dosTime),
    ...writeUint16LE(dosDate),
    ...writeUint32LE(checksum),
    ...writeUint32LE(compressed.length),
    ...writeUint32LE(rawData.length),
    ...writeUint16LE(filenameBytes.length),
    ...writeUint16LE(0),
    ...writeUint16LE(0),
    ...writeUint16LE(0),
    ...writeUint16LE(0),
    ...writeUint32LE(0),
    ...writeUint32LE(0),
    ...filenameBytes,
  ]);

  const centralOffset = localHeader.length + compressed.length;
  const eocd = new Uint8Array([
    ...writeUint32LE(0x06054b50),
    ...writeUint16LE(0),
    ...writeUint16LE(0),
    ...writeUint16LE(1),
    ...writeUint16LE(1),
    ...writeUint32LE(centralHeader.length),
    ...writeUint32LE(centralOffset),
    ...writeUint16LE(0),
  ]);

  return concatArrays([localHeader, compressed, centralHeader, eocd]);
}

async function tursoPipeline(env, statements) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw new Error('Turso environment not configured');
  }

  const url = `${env.TURSO_DATABASE_URL.replace(/\/$/, '')}/v2/pipeline`;
  const body = JSON.stringify({ requests: statements });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!res.ok) {
    throw new Error(`Turso pipeline failed: HTTP ${res.status}`);
  }

  const data = await res.json();
  const firstError = data?.results?.[0]?.response?.error;
  if (firstError) {
    throw new Error(`Turso query error: ${firstError.message || JSON.stringify(firstError)}`);
  }

  return data;
}

function rowsToObjects(result) {
  const cols = (result?.cols || []).map((c) => c.name);
  const rows = result?.rows || [];
  return rows.map((row) => {
    const obj = {};
    for (let i = 0; i < cols.length; i++) {
      let value = row[i];
      if (typeof value === 'object' && value !== null && 'value' in value) {
        value = value.value;
      }
      obj[cols[i]] = value;
    }
    return obj;
  });
}

async function queryActiveShows(env) {
  const data = await tursoPipeline(env, [
    { type: 'execute', stmt: { sql: SHOWS_QUERY } },
  ]);
  const result = data?.results?.[0]?.response?.result;
  return rowsToObjects(result);
}

async function queryShowInventory(env, showId) {
  const data = await tursoPipeline(env, [
    {
      type: 'execute',
      stmt: {
        sql: INVENTORY_QUERY,
        args: [{ type: 'text', value: showId }],
      },
    },
  ]);
  const result = data?.results?.[0]?.response?.result;
  return rowsToObjects(result);
}

function sanitizeInventory(rows) {
  // Schema is already public; just ensure no show_id / vendor_id leak.
  return rows.map((row) => ({
    id: String(row.id ?? ''),
    product_id: Number(row.product_id) || 0,
    name: String(row.name ?? ''),
    set_name: String(row.set_name ?? ''),
    number: String(row.number ?? ''),
    rarity: String(row.rarity ?? ''),
    condition: String(row.condition ?? ''),
    sticker_price: Number(row.sticker_price) || 0,
    quantity: Number(row.quantity) || 0,
    vendor_name: String(row.vendor_name ?? ''),
    vendor_table: String(row.vendor_table ?? ''),
  }));
}

async function processShow(env, show) {
  const showId = show.id;
  console.log(`[pre-show] generating catalog for show ${showId}`);

  const rawRows = await queryShowInventory(env, showId);
  const sanitized = sanitizeInventory(rawRows);
  const json = JSON.stringify(sanitized);
  const jsonBytes = new TextEncoder().encode(json);
  const zipBytes = await buildZip(ZIP_FILENAME, jsonBytes);

  const key = `shows/${showId}/event_catalog.json.zip`;
  await env.EVENT_CATALOG_BUCKET.put(key, zipBytes, {
    httpMetadata: {
      contentType: 'application/zip',
      cacheControl: 'max-age=0, no-cache, no-store, must-revalidate',
    },
  });

  console.log(`[pre-show] uploaded ${key} (${zipBytes.length} bytes, ${sanitized.length} rows)`);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/trigger' && request.method === 'POST') {
      console.log('[pre-show] manual trigger');
      try {
        const shows = await queryActiveShows(env);
        if (!shows.length) {
          return new Response(JSON.stringify({ ok: true, message: 'no active shows' }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        const results = [];
        for (const show of shows) {
          const result = await processShow(env, show).then(() => ({ ok: true, showId: show.id })).catch((err) => ({ ok: false, showId: show.id, error: err.message }));
          results.push(result);
        }
        return new Response(JSON.stringify({ ok: true, results }, null, 2), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response('ok', { status: 200 });
  },
};
