import { act } from 'react';
import {
  mkCustomerInfo,
  mkVendorProfile,
} from './helpers/builders';
import { renderHook } from './helpers/renderHook';
import { useVendorFeatures } from '../src/hooks/useVendorFeatures';
import { useShowVendorStore } from '../src/store/showVendorStore';
import { useSubscriptionStore } from '../src/store/subscriptionStore';

// The gate: paymentsLive off → open; on → needs isVendor OR isTeamMember
// OR an active Cardcache_pro entitlement. The hook's value over the store's
// imperative canUseVendorFeatures() is that both subscriptions re-render —
// the entitlement test below exercises exactly that.

beforeEach(() => {
  act(() => {
    useShowVendorStore.setState({ profile: null });
    useSubscriptionStore.setState({ customerInfo: null });
  });
});

test('paymentsLive off unlocks vendor features regardless of flags', () => {
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.paymentsLive).toBe(false);
  expect(result.current.canUseVendorFeatures).toBe(true);

  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: false }),
    });
  });
  expect(result.current.canUseVendorFeatures).toBe(true);
});

test('paymentsLive on gates features with no vendor/team/entitlement', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
    });
  });
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.paymentsLive).toBe(true);
  expect(result.current.canUseVendorFeatures).toBe(false);
});

test('isVendor profile flag passes the gate when payments live', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true, isVendor: true }),
    });
  });
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.canUseVendorFeatures).toBe(true);
});

test('isTeamMember profile flag passes the gate when payments live', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true, isTeamMember: true }),
    });
  });
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.canUseVendorFeatures).toBe(true);
});

test('vendor entitlement passes the gate when payments live', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
    });
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_pro']),
    });
  });
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.canUseVendorFeatures).toBe(true);
});

test('scan-only entitlement does not unlock vendor features', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
    });
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_scan']),
    });
  });
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.canUseVendorFeatures).toBe(false);
});

test('gate reacts to a late-arriving entitlement without remounting', () => {
  act(() => {
    useShowVendorStore.setState({
      profile: mkVendorProfile({ paymentsLive: true }),
    });
  });
  const { result } = renderHook(() => useVendorFeatures());
  expect(result.current.canUseVendorFeatures).toBe(false);

  // The point of the hook: the selector output changes when the store
  // changes — the store's imperative canUseVendorFeatures() getState() read
  // would not re-render a mounted component.
  act(() => {
    useSubscriptionStore.setState({
      customerInfo: mkCustomerInfo(['Cardcache_pro']),
    });
  });
  expect(result.current.canUseVendorFeatures).toBe(true);
});
