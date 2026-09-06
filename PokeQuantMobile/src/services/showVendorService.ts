import { getAuthToken } from '../api/cloudSync';
import { SHOW_VENDOR_WORKER_URL, getShowTriggerUrl } from '../constants/api';
import { getCatalogImageUri } from './CatalogImageService';

export type ShowVendorProfile = {
  id: string;
  user_id: string;
  name: string;
  table_default: string;
};

export type VendorShow = {
  id: string;
  vendor_id: string;
  name: string;
  start_date: string;
  location: string;
  is_active: number;
};

export type ShowInventoryRow = {
  id?: string;
  product_id: number;
  name: string;
  set_name?: string;
  number?: string;
  rarity?: string;
  condition?: string;
  sticker_price: number;
  quantity: number;
};

export type ShowListingItem = {
  id: string;
  showId: string;
  productId: number;
  name: string;
  number: string;
  set: string;
  rarity: string;
  condition: string;
  stickerPrice: number;
  quantity: number;
  vendorName: string;
  vendorTable: string;
  imageUrl?: string;
};

export type ShowUploadPayload = {
  show_id: string;
  vendor_name: string;
  vendor_table: string;
  rows: ShowInventoryRow[];
};

type ApiResponse<T> = { ok: true } & T;

async function postAuth(path: string, body: unknown): Promise<any> {
  const token = await getAuthToken();
  const res = await fetch(`${SHOW_VENDOR_WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Show vendor request failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from show vendor worker: ${text}`);
  }
}

async function getAuth(path: string): Promise<any> {
  const token = await getAuthToken();
  const res = await fetch(`${SHOW_VENDOR_WORKER_URL}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Show vendor request failed: ${res.status} ${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from show vendor worker: ${text}`);
  }
}

function toListingItem(row: any): ShowListingItem {
  const productId = Number(row.product_id) || 0;
  return {
    id: String(row.id ?? ''),
    showId: String(row.show_id ?? ''),
    productId,
    name: String(row.name ?? ''),
    number: String(row.number ?? ''),
    set: String(row.set_name ?? ''),
    rarity: String(row.rarity ?? ''),
    condition: String(row.condition ?? ''),
    stickerPrice: Number(row.sticker_price) || 0,
    quantity: Number(row.quantity) || 0,
    vendorName: String(row.vendor_name ?? ''),
    vendorTable: String(row.vendor_table ?? ''),
    imageUrl: getCatalogImageUri(productId),
  };
}

export async function getVendorShows(): Promise<string[]> {
  const data = (await getAuth('/vendor/shows')) as ApiResponse<{ shows: VendorShow[] }>;
  return (data.shows || []).map((s) => String(s.id));
}

export async function getVendorProfile(): Promise<ShowVendorProfile> {
  const data = (await getAuth('/vendor/me')) as ApiResponse<{ vendor: any }>;
  const v = data.vendor;
  return {
    id: String(v.id ?? ''),
    user_id: String(v.user_id ?? ''),
    name: String(v.name ?? ''),
    table_default: String(v.table_default ?? ''),
  };
}

export async function getVendorListings(showId: string): Promise<ShowListingItem[]> {
  const data = (await getAuth(`/vendor/inventory?show_id=${encodeURIComponent(showId)}`)) as ApiResponse<{ show_id: string; rows: any[] }>;
  return (data.rows || []).map(toListingItem);
}

export async function uploadShowInventory(
  showId: string,
  vendorName: string,
  vendorTable: string,
  rows: ShowInventoryRow[]
): Promise<string[]> {
  const payload: ShowUploadPayload = {
    show_id: showId,
    vendor_name: vendorName,
    vendor_table: vendorTable,
    rows,
  };
  const data = (await postAuth('/vendor/inventory', payload)) as ApiResponse<{ row_ids: string[] }>;
  return data.row_ids || [];
}

export async function updateShowListing(
  rowId: string,
  updates: Partial<ShowInventoryRow> & Partial<Pick<ShowListingItem, 'vendorName' | 'vendorTable'>>
): Promise<void> {
  const body: Record<string, any> = { id: rowId };
  if (updates.name !== undefined) body.name = updates.name;
  if (updates.set_name !== undefined) body.set_name = updates.set_name;
  if (updates.number !== undefined) body.number = updates.number;
  if (updates.rarity !== undefined) body.rarity = updates.rarity;
  if (updates.condition !== undefined) body.condition = updates.condition;
  if (updates.sticker_price !== undefined) body.sticker_price = updates.sticker_price;
  if (updates.quantity !== undefined) body.quantity = updates.quantity;
  if (updates.vendorName !== undefined) body.vendor_name = updates.vendorName;
  if (updates.vendorTable !== undefined) body.vendor_table = updates.vendorTable;
  await postAuth('/vendor/inventory/update', body);
}

export async function deleteShowListing(rowId: string): Promise<void> {
  await postAuth('/vendor/inventory/delete', { id: rowId });
}

export async function triggerShowSnapshot(showId: string): Promise<void> {
  const url = getShowTriggerUrl(showId);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Show trigger failed: ${res.status} ${text}`);
  }
}
