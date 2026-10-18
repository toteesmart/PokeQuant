import { getAuthToken } from '../src/api/cloudSync';
import { getCatalogImageUri } from '../src/services/CatalogImageService';
import {
  addShowRegistration,
  deleteShowListing,
  deleteVendorAccount,
  getMyBalances,
  getShowRegistrations,
  getTeam,
  getVendorListings,
  getVendorProfile,
  getVendorShows,
  leaveTeam,
  redeemTeamCode,
  regenerateTeamCode,
  removeTeamMember,
  renameTeam,
  requestShowAccess,
  syncVendorSubscription,
  triggerShowSnapshot,
  updateShow,
  updateShowListing,
  updateShowRegistration,
  uploadShowInventory,
  type ShowInventoryRow,
} from '../src/services/showVendorService';

jest.mock('../src/api/cloudSync', () => ({
  getAuthToken: jest.fn(async () => 'tok'),
}));

jest.mock('../src/services/CatalogImageService', () => ({
  getCatalogImageUri: jest.fn((id: number) => `img:${id}`),
}));

const W = 'https://pokequant-vendor.totees-mart.workers.dev';
const TRIGGER_BASE = 'https://pokequant-pre-show.totees-mart.workers.dev/trigger';

const fetchMock = jest.fn();
const realFetch = globalThis.fetch;
const mockGetToken = jest.mocked(getAuthToken);

const okJson = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200 });

const lastCall = (): [string, RequestInit] =>
  fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];

beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});

afterAll(() => {
  (globalThis as { fetch: unknown }).fetch = realFetch;
  jest.restoreAllMocks();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('request shapes', () => {
  test('getVendorShows issues an authorized GET with no Content-Type or body', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true, shows: [{ id: 's1' }] }));

    const res = await getVendorShows();

    expect(res).toEqual([{ id: 's1' }]);
    const [url, init] = lastCall();
    expect(url).toBe(`${W}/vendor/shows`);
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
    expect(init.body).toBeUndefined();
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  test('uploadShowInventory posts the snake_case payload and returns row_ids', async () => {
    const rows: ShowInventoryRow[] = [
      { product_id: 1, name: 'Pikachu', sticker_price: 9.5, quantity: 2 },
    ];
    fetchMock.mockResolvedValue(okJson({ ok: true, row_ids: ['r1', 'r2'] }));

    const res = await uploadShowInventory('s1', 'Totees', '12', rows);

    expect(res).toEqual(['r1', 'r2']);
    const [url, init] = lastCall();
    expect(url).toBe(`${W}/vendor/inventory`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer tok',
    });
    expect(init.body).toBe(
      JSON.stringify({
        show_id: 's1',
        vendor_name: 'Totees',
        vendor_table: '12',
        rows,
      }),
    );
  });

  test('uploadShowInventory returns [] when the worker omits row_ids', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));
    expect(await uploadShowInventory('s1', 'V', '1', [])).toEqual([]);
  });

  test('updateShow PATCHes the encoded show id', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await updateShow('a b/c', { is_active: false });

    const [url, init] = lastCall();
    expect(url).toBe(`${W}/shows/a%20b%2Fc`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ is_active: false }));
  });

  test('updateShowRegistration PATCHes the encoded manual vendor id', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await updateShowRegistration('s1', 'manual:x y', { paid_amount: 5 });

    const [url, init] = lastCall();
    expect(url).toBe(`${W}/shows/s1/registrations/manual%3Ax%20y`);
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ paid_amount: 5 }));
  });

  test('updateShowListing sends only the defined keys and keeps quantity:0', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await updateShowListing('r1', {
      name: 'N',
      vendorName: 'VN',
      vendorTable: 'T',
      quantity: 0,
    });

    const [url, init] = lastCall();
    expect(url).toBe(`${W}/vendor/inventory/update`);
    expect(init.body).toBe(
      JSON.stringify({ id: 'r1', name: 'N', quantity: 0, vendor_name: 'VN', vendor_table: 'T' }),
    );
  });

  test('deleteShowListing posts the row id', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));

    await deleteShowListing('r1');

    const [url, init] = lastCall();
    expect(url).toBe(`${W}/vendor/inventory/delete`);
    expect(init.body).toBe(JSON.stringify({ id: 'r1' }));
  });

  test.each<[string, () => Promise<unknown>, string, unknown]>([
    ['redeemTeamCode', () => redeemTeamCode('ABC'), '/vendor/team/redeem', { code: 'ABC' }],
    ['regenerateTeamCode', () => regenerateTeamCode(), '/vendor/team/regenerate-code', {}],
    ['renameTeam', () => renameTeam('Crew'), '/vendor/team/rename', { name: 'Crew' }],
    [
      'removeTeamMember',
      () => removeTeamMember('m1'),
      '/vendor/team/remove',
      { member_user_id: 'm1' },
    ],
    ['leaveTeam', () => leaveTeam(), '/vendor/team/leave', {}],
    ['deleteVendorAccount', () => deleteVendorAccount(), '/vendor/delete-account', {}],
    ['syncVendorSubscription', () => syncVendorSubscription(), '/vendor/sync-subscription', {}],
    ['requestShowAccess', () => requestShowAccess('s/1'), '/vendor/shows/s%2F1/request', {}],
  ])('%s POSTs the expected path and body', async (_name, call, path, body) => {
    fetchMock.mockResolvedValue(okJson({ ok: true, team: { team_id: 't1' } }));

    await call();

    const [url, init] = lastCall();
    expect(url).toBe(`${W}${path}`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(body));
  });

  test('addShowRegistration posts the payload verbatim', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));
    const payload = { vendor_id: 'v1', table_number: '4', total_due: 40 };

    await addShowRegistration('s1', payload);

    const [url, init] = lastCall();
    expect(url).toBe(`${W}/shows/s1/registrations`);
    expect(init.body).toBe(JSON.stringify(payload));
  });
});

describe('mappings', () => {
  test('getVendorListings encodes the query param and maps snake rows', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        ok: true,
        rows: [
          {
            id: 'r1',
            show_id: 's 1',
            product_id: '42',
            name: 'N',
            number: '7',
            set_name: 'Base',
            rarity: 'Rare',
            condition: 'NM',
            sticker_price: '9.5',
            quantity: '2',
            vendor_name: 'VN',
            vendor_table: 'T1',
          },
          { id: 'r2' },
        ],
      }),
    );

    const res = await getVendorListings('s 1');

    expect(lastCall()[0]).toBe(`${W}/vendor/inventory?show_id=s%201`);
    expect(res).toEqual([
      {
        id: 'r1',
        showId: 's 1',
        productId: 42,
        name: 'N',
        number: '7',
        set: 'Base',
        rarity: 'Rare',
        condition: 'NM',
        stickerPrice: 9.5,
        quantity: 2,
        vendorName: 'VN',
        vendorTable: 'T1',
        imageUrl: 'img:42',
      },
      {
        id: 'r2',
        showId: '',
        productId: 0,
        name: '',
        number: '',
        set: '',
        rarity: '',
        condition: '',
        stickerPrice: 0,
        quantity: 0,
        vendorName: '',
        vendorTable: '',
        imageUrl: 'img:0',
      },
    ]);
    expect(getCatalogImageUri).toHaveBeenCalledWith(42);
  });

  test('getVendorListings returns [] when rows are absent', async () => {
    fetchMock.mockResolvedValue(okJson({ ok: true }));
    expect(await getVendorListings('s1')).toEqual([]);
  });

  test('getVendorProfile coerces flags and nulls', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        ok: true,
        vendor: {
          id: 'v',
          user_id: 'u',
          name: 'N',
          table_default: 't',
          is_founder: '1',
          founder_seat_number: null,
          payments_live: 0,
          founder_seats_remaining: '3',
          is_vendor: 1,
          is_team_member: 0,
          is_organizer: true,
          team: null,
        },
      }),
    );

    const res = await getVendorProfile();

    expect(res).toEqual({
      id: 'v',
      user_id: 'u',
      name: 'N',
      table_default: 't',
      is_founder: 1,
      founder_seat_number: null,
      payments_live: 0,
      founder_seats_remaining: 3,
      is_vendor: 1,
      is_team_member: 0,
      is_organizer: 1,
      team_id: null,
      team: null,
    });
  });

  test('getTeam maps the team, falls back to owner id, and leaves absent fields undefined', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        ok: true,
        team: {
          owner_user_id: 'u1',
          seats_total: '4',
          is_member: 1,
          members: [{ member_user_id: 'm', member_name: 7, created_at: '5' }],
        },
      }),
    );

    const res = await getTeam();

    expect(lastCall()[0]).toBe(`${W}/vendor/team`);
    expect(res).toEqual({
      team_id: 'u1',
      owner_user_id: 'u1',
      name: null,
      owner_name: null,
      product_id: null,
      seats_total: 4,
      seats_used: undefined,
      expires_at: null,
      updated_at: null,
      created_at: null,
      invite_code: null,
      is_member: true,
      is_owner: undefined,
      members: [{ member_user_id: 'm', member_name: '7', created_at: 5 }],
    });
  });

  test('getTeam leaves members undefined when the field is not an array and returns null for team:null', async () => {
    fetchMock.mockResolvedValue(
      okJson({ ok: true, team: { team_id: 't2', owner_user_id: 'o', members: 'junk' } }),
    );
    const res = await getTeam();
    expect(res?.team_id).toBe('t2');
    expect(res?.members).toBeUndefined();

    fetchMock.mockResolvedValue(okJson({ ok: true, team: null }));
    expect(await getTeam()).toBeNull();
  });

  test('getShowRegistrations flags manual vendors and defaults status/createdAt', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        ok: true,
        registrations: [
          { vendor_id: 'manual:abc' },
          { vendor_id: 'v2', is_manual: 1 },
          { vendor_id: 'v3', status: 'approved', created_at: '9' },
        ],
      }),
    );

    const res = await getShowRegistrations('s1');

    expect(lastCall()[0]).toBe(`${W}/shows/s1/registrations`);
    expect(res.map((r) => [r.vendorId, r.isManual, r.status, r.createdAt])).toEqual([
      ['manual:abc', true, 'pending', null],
      ['v2', true, 'pending', null],
      ['v3', false, 'approved', 9],
    ]);
  });

  test('getMyBalances maps snake rows to camelCase numbers', async () => {
    fetchMock.mockResolvedValue(
      okJson({
        ok: true,
        balances: [
          {
            show_id: 's',
            show_name: 'N',
            organizer_name: 'O',
            pay_instructions: 'P',
            table_number: '1',
            total_due: '10',
            paid_amount: '4',
            remaining: '6',
          },
        ],
      }),
    );

    const res = await getMyBalances();

    expect(lastCall()[0]).toBe(`${W}/vendor/balances`);
    expect(res).toEqual([
      {
        showId: 's',
        showName: 'N',
        organizerName: 'O',
        payInstructions: 'P',
        tableNumber: '1',
        totalDue: 10,
        paidAmount: 4,
        remaining: 6,
      },
    ]);
  });
});

describe('errors', () => {
  test('a non-ok status rejects with status + raw body', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));

    await expect(getVendorShows()).rejects.toThrow('Show vendor request failed: 500 boom');
  });

  test('a non-JSON ok body rejects with the invalid-JSON message', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }));

    await expect(getVendorShows()).rejects.toThrow(
      'Invalid JSON from show vendor worker: not json',
    );
  });

  test('an offline fetch error maps to the offline message', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    await expect(getVendorShows()).rejects.toThrow('Internet connection is offline.');
  });

  test('other fetch errors are rethrown as-is', async () => {
    const err = new Error('kaput');
    fetchMock.mockRejectedValue(err);

    await expect(getVendorShows()).rejects.toBe(err);
  });
});

describe('triggerShowSnapshot', () => {
  test('POSTs the pre-show trigger URL without auth', async () => {
    fetchMock.mockResolvedValue(new Response('ok', { status: 200 }));

    await triggerShowSnapshot('s1');

    const [url, init] = lastCall();
    expect(url).toBe(`${TRIGGER_BASE}/s1`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  test('non-ok rejects with status + body', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 503 }));

    await expect(triggerShowSnapshot('s1')).rejects.toThrow('Show trigger failed: 503 nope');
  });

  test('offline maps to the offline message', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    await expect(triggerShowSnapshot('s1')).rejects.toThrow('Internet connection is offline.');
  });
});
