// PricingPreview's pure plan layer: fallback price table (renders before
// RevenueCat offerings load), section ordering, package display mapping,
// and the eligibility rules for which plan card is tappable.
//
// Behavior contract lives here — the paywall JSX consumes these helpers
// and should stay free of pricing rules.

import type { PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import {
  COLLECTOR_OFFERING_ID,
  FOUNDER_OFFERING_ID,
  PRICING_PACKAGE_IDS,
  PRO_OFFERING_ID,
  REVENUECAT_PRODUCTS,
  TEAM_EXTRA_OFFERING_ID,
  isExtraSeatProduct,
  isFounderProduct,
  isScanProduct,
} from '../../constants/revenuecat';
import { formatPrice } from '../../services/revenueCat';

const FALLBACK_PLANS = [
  {
    offering: 'collector',
    title: 'Collector',
    subtitle: 'Unlimited scanning, even without internet',
    packages: [
      { id: REVENUECAT_PRODUCTS.scanMonthly, title: 'Monthly', price: '$4.99' },
      { id: REVENUECAT_PRODUCTS.scanYearly, title: 'Yearly', price: '$29.99' },
    ],
  },
  {
    offering: 'founders',
    title: 'Founders',
    subtitle: 'First 50 sign-ups only',
    packages: [
      { id: REVENUECAT_PRODUCTS.founderIndividual, title: 'Individual', price: '$7.99' },
      { id: REVENUECAT_PRODUCTS.founderTeam, title: '3 people', price: '$14.99' },
    ],
  },
  {
    offering: 'pro',
    title: 'Pro',
    subtitle: 'All selling tools',
    packages: [
      { id: REVENUECAT_PRODUCTS.proIndividual, title: 'Individual', price: '$14.99' },
      {
        id: REVENUECAT_PRODUCTS.proIndividualYearly,
        title: 'Individual · Yearly',
        price: '$119.99',
      },
      { id: REVENUECAT_PRODUCTS.proTeam, title: '3 people', price: '$34.99' },
    ],
  },
  {
    offering: 'teams_extra_seat',
    title: 'Add a Team Member',
    subtitle: 'Add to a Pro Team plan',
    packages: [
      { id: REVENUECAT_PRODUCTS.proExtraSeat, title: 'One more person', price: '$9.99 / mo' },
    ],
  },
];

export function getOfferingLabel(offering: string): string {
  if (offering === COLLECTOR_OFFERING_ID) return 'Collector';
  if (offering === FOUNDER_OFFERING_ID) return 'Founder';
  if (offering === PRO_OFFERING_ID) return 'Pro';
  if (offering === TEAM_EXTRA_OFFERING_ID) return 'Team member';
  return offering;
}

function getPackageTitle(productId: string, fallback: string): string {
  // Section headers carry the plan name, so card titles stay terse.
  if (productId === REVENUECAT_PRODUCTS.scanMonthly) return 'Monthly';
  if (productId === REVENUECAT_PRODUCTS.scanYearly) return 'Yearly';
  if (productId === REVENUECAT_PRODUCTS.founderIndividual) return 'Founder Individual';
  if (productId === REVENUECAT_PRODUCTS.founderTeam) return 'Founder Team (3 people)';
  if (productId === REVENUECAT_PRODUCTS.proIndividual) return 'Monthly';
  if (productId === REVENUECAT_PRODUCTS.proIndividualYearly) return 'Yearly';
  if (productId === REVENUECAT_PRODUCTS.proTeam) return 'Pro Team (3 people)';
  if (productId === REVENUECAT_PRODUCTS.proExtraSeat) return 'Extra member';
  return fallback;
}

export function billingPeriod(productId: string): string {
  return productId.endsWith('_yearly') ? '/ yr' : '/ mo';
}

// Three horizontal rows — collector first (attendees are the majority), then
// individual, then team. Founders sit inside their matching row.
export const PLAN_SECTIONS = [
  {
    key: 'collector',
    title: 'Collector',
    blurb: 'Unlimited scanning — no daily limit, works without internet.',
    order: [REVENUECAT_PRODUCTS.scanMonthly, REVENUECAT_PRODUCTS.scanYearly],
  },
  {
    key: 'individual',
    title: 'Pro Individual',
    blurb:
      'Selling tools: list at shows, buy offers, sticker pricing. Founder locks launch pricing — first 50.',
    order: [
      REVENUECAT_PRODUCTS.founderIndividual,
      REVENUECAT_PRODUCTS.proIndividual,
      REVENUECAT_PRODUCTS.proIndividualYearly,
    ],
  },
  {
    key: 'team',
    title: 'Pro Team',
    blurb: 'Pro for your whole crew — each teammate gets their own account.',
    order: [
      REVENUECAT_PRODUCTS.founderTeam,
      REVENUECAT_PRODUCTS.proTeam,
      REVENUECAT_PRODUCTS.proExtraSeat,
    ],
  },
] as const;

export type DisplayPackage = {
  id: string;
  title: string;
  price: string;
  offering: string;
  pkg?: PurchasesPackage;
  isFallback: boolean;
};

const allowedProductIds = new Set<string>(PRICING_PACKAGE_IDS as unknown as string[]);

// Live offerings when RevenueCat has them, otherwise the static fallback
// table — filtered to the shipped product list either way.
export function buildDisplayPackages(offerings: PurchasesOfferings | null): {
  items: DisplayPackage[];
  hasLiveData: boolean;
} {
  const livePackages: { offering: string; pkg: PurchasesPackage }[] = [];
  if (offerings?.all) {
    for (const id of [
      COLLECTOR_OFFERING_ID,
      FOUNDER_OFFERING_ID,
      PRO_OFFERING_ID,
      TEAM_EXTRA_OFFERING_ID,
    ]) {
      const offering = offerings.all[id];
      if (!offering) continue;
      for (const pkg of offering.availablePackages) {
        if (allowedProductIds.has(pkg.product.identifier)) {
          livePackages.push({ offering: id, pkg });
        }
      }
    }
  }

  if (livePackages.length > 0) {
    return {
      hasLiveData: true,
      items: livePackages.map(({ offering, pkg }) => ({
        id: pkg.product.identifier,
        title: getPackageTitle(pkg.product.identifier, pkg.product.title || pkg.identifier),
        price: formatPrice(pkg.product),
        offering,
        pkg,
        isFallback: false,
      })),
    };
  }

  return {
    hasLiveData: false,
    items: FALLBACK_PLANS.flatMap((o) =>
      o.packages
        .filter((p) => allowedProductIds.has(p.id))
        .map((p) => ({
          id: p.id,
          title: getPackageTitle(p.id, p.title),
          price: p.price,
          offering: o.offering,
          isFallback: true,
        })),
    ),
  };
}

type PlanEligibility = {
  activeProductId: string | null;
  isFounder: boolean;
  founderSeatNumber?: number | null;
  founderSeatsRemaining: number;
  isActiveTeamOwner: boolean;
  isVendor: boolean | undefined;
};

// "Current plan" — the single predicate both the selected badge and the
// disabled rules go through; keep them in one place so they can't drift.
export function isActivePackage(item: DisplayPackage, activeProductId: string | null): boolean {
  return !item.isFallback && !!item.pkg && activeProductId === item.pkg.product.identifier;
}

// A card is tappable only when it's a live package the user is allowed to
// buy: not their current plan, founder-gated founders plans, extra seats
// for active team owners only, and collector plans hidden from Pro-level
// vendors (no crossgrade down into a scans-only product).
export function isPackageDisabled(item: DisplayPackage, ctx: PlanEligibility): boolean {
  const isActive = isActivePackage(item, ctx.activeProductId);
  const isFounderEligible =
    ctx.isFounder || ctx.founderSeatNumber != null || ctx.founderSeatsRemaining > 0;

  return (
    !item.pkg ||
    isActive ||
    (isFounderProduct(item.id) && !isFounderEligible) ||
    (isExtraSeatProduct(item.id) && !ctx.isActiveTeamOwner) ||
    (isScanProduct(item.id) && !!ctx.isVendor)
  );
}
