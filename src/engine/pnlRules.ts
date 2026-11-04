import { PnLConfig } from '../types';

export const PNL_STAGE_COUNT = 5;

/**
 * Validates the 5-stage trailing profit-floor configuration WITHOUT changing
 * how the rules are applied. Returns a human-readable error or null.
 */
export function validatePnLConfig(config: PnLConfig | null | undefined): string | null {
  if (!config || !Array.isArray(config.rules)) return 'PnL rules are missing.';
  if (config.rules.length !== PNL_STAGE_COUNT) return `Exactly ${PNL_STAGE_COUNT} PnL stages are required.`;
  for (let i = 0; i < config.rules.length; i++) {
    const rule = config.rules[i];
    const stage = `Stage ${i + 1}`;
    if (!rule || ![rule.fromPct, rule.toPct, rule.dropPct].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      return `${stage}: Profit From, Profit To and Profit Drop must be numbers.`;
    }
    if (rule.fromPct < 0) return `${stage}: Profit From cannot be negative.`;
    if (rule.toPct < rule.fromPct) return `${stage}: Profit To must be greater than or equal to Profit From.`;
    if (rule.dropPct < 0 || rule.dropPct > 100) return `${stage}: Profit Drop must be between 0 and 100.`;
    if (i > 0 && rule.fromPct <= config.rules[i - 1].toPct) {
      return `${stage}: ranges must ascend without overlapping (starts at ${rule.fromPct}% but Stage ${i} ends at ${config.rules[i - 1].toPct}%).`;
    }
  }
  if (typeof config.fixedFloorEnabled !== 'boolean') return 'Fixed Floor Preset Mode must be on or off.';
  if (config.fixedFloorEnabled) {
    const { fixedFloorTriggerPct: trigger, fixedFloorLockPct: lock } = config;
    if (!Number.isFinite(trigger) || !Number.isFinite(lock)) return 'Fixed floor trigger and lock must be numbers.';
    if (trigger <= 0) return 'Fixed floor trigger must be positive.';
    if (lock < 0 || lock >= trigger) return 'Fixed floor lock must be at least 0 and below the trigger.';
  }
  return null;
}
