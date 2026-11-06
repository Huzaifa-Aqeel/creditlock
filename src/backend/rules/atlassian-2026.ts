import { POLICY } from '../discovery-domain';

export const ATLASSIAN_PREMIUM_2026 = {
  ...POLICY,
  product: 'Jira Service Management',
  plan: 'Premium',
  coveredExperience: 'browser',
  thresholdNumerator: 999,
  thresholdDenominator: 1000,
  tiers: [
    { uptimeBelowNumerator: 95, uptimeDenominator: 100, creditPercent: 50 },
    { uptimeBelowNumerator: 99, uptimeDenominator: 100, creditPercent: 25 },
    { uptimeBelowNumerator: 999, uptimeDenominator: 1000, creditPercent: 10 },
  ],
} as const;
