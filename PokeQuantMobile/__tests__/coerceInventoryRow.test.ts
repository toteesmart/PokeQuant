import { coerceInventoryRow } from '../src/db/inventoryDb';

describe('coerceInventoryRow', () => {
  it('throws when id is missing', () => {
    expect(() => coerceInventoryRow({})).toThrow('Inventory row missing required id');
  });

  it('coerces a snake_case remote row', () => {
    const row = {
      id: 'abc123',
      user_id: 'u-1',
      product_id: 12345,
      card_name: 'Pikachu',
      card_number: '25',
      set_name: 'Base Set',
      variant: 'Holo',
      condition: 'nm',
      purchase_price: 5.0,
      sticker_price: 10.0,
      date_bought: '2026-01-01T00:00:00.000Z',
      is_bulk_deal: 0,
      is_sold: 0,
      sold_price: 0,
      date_sold: '',
      custom_image_data: '',
      is_deleted: 0,
      updated_at: 1,
    };

    const out = coerceInventoryRow(row, 'u-1');
    expect(out.id).toBe('abc123');
    expect(out.user_id).toBe('u-1');
    expect(out.product_id).toBe(12345);
    expect(out.card_name).toBe('Pikachu');
    expect(out.purchase_price).toBe(5);
    expect(out.sticker_price).toBe(10);
    expect(out.is_sold).toBe(false);
    expect(out.is_deleted).toBe(false);
    expect(out.updated_at).toBe(1);
  });

  it('falls back to userId argument when user_id is missing', () => {
    const out = coerceInventoryRow({ id: 'x', product_id: 0 }, 'fallback-user');
    expect(out.user_id).toBe('fallback-user');
    expect(out.product_id).toBeNull();
  });

  it('coerces boolean strings and numbers', () => {
    const out = coerceInventoryRow(
      { id: 'x', is_sold: 'true', is_deleted: 1, is_bulk_deal: 'yes' },
      'u-1'
    );
    expect(out.is_sold).toBe(true);
    expect(out.is_deleted).toBe(true);
    expect(out.is_bulk_deal).toBe(true);
  });
});
