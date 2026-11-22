import type { TaxAnswers } from '../formalization/formalization';
import type { Classification, SectionKey, StoredDocument } from './journey';

/** Compatibility view of the guided tax preparation kept for `/luft/tax-return`. */
export interface TaxReturnState {
  taxYear: number;
  status: 'DRAFT' | 'CONFIGURATION_REQUIRED';
  answers?: TaxAnswers;
  requestedAt?: string;
  updatedAt: string;
}

/** Everything the journey keeps inside FinancialProfile.demographicAnswers. */
export interface JourneyState {
  classification?: Classification & { answeredAt: string };
  context?: string;
  sections?: Partial<Record<SectionKey, string>>;
  documents?: StoredDocument[];
  taxReturn?: TaxReturnState;
  [legacy: string]: unknown;
}

export function readJourneyState(value: unknown): JourneyState {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JourneyState)
    : {};
}
