export const GAME_CODES: Record<string, string[]>;
export function clean(s: string): string;
export function parseParties(text: string): { name: string; cls: string; location: string; code: string; team: Record<string, unknown>[] }[];
export function collectTrainers(text: string, kind: 'gym' | 'league', league?: Record<string, string>): Record<string, Record<string, unknown>[]>;
