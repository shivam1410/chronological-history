/**
 * Named windows for the era-jump buttons.
 *
 * These are navigation shortcuts, not data: they exist so any part of 4.54
 * billion years is one click away from any zoom level. Bounds are padded a
 * little past the strict geological definition so the era's own entries are not
 * flush against the window edge.
 */

import { ORIGIN_YEAR, presentYear } from './timescale.js';

export const ERAS = [
  { id: 'hadean', label: 'Hadean', from: ORIGIN_YEAR, to: -3_800_000_000 },
  { id: 'mesozoic', label: 'Mesozoic', from: -260_000_000, to: -60_000_000 },
  { id: 'ice-age', label: 'Ice Age', from: -2_800_000, to: -8_000 },
  { id: 'bronze-age', label: 'Bronze Age', from: -3_600, to: -1_000 },
  { id: 'classical', label: 'Classical', from: -800, to: 600 },
  { id: 'medieval', label: 'Medieval', from: 450, to: 1_550 },
  { id: 'modern', label: 'Modern', from: 1_500, to: presentYear() },
];

export const FULL_RANGE = { from: ORIGIN_YEAR, to: presentYear() };
