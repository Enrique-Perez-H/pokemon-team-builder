import type { Build } from './sets';

/** One saved team slot. Lives in the engine so import/export and the UI share a single shape. */
export interface Slot {
  species: string;
  ability?: string;
  moves: string[];
  /** Level, nature, EVs, IVs and item. Missing means "use the suggested competitive build". */
  build?: Build;
  /** Locked slots are kept when the optimizer rebuilds the team. */
  locked?: boolean;
}
