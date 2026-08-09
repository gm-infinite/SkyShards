import type { Shard } from "../types/types";
import { MAX_QUANTITIES } from "../constants";

/**
 * IMPORTANT: `ownedAttributes` (from Hypixel import / `AttributeOwned.level`)
 * holds the RAW number of shards already synthesized into that attribute —
 * on the same 0-96/64/48/32/24 scale as `MAX_QUANTITIES`, NOT a 0-10 "level".
 * This matches how `InventoryManagementModal` already displays it
 * (`{attr.level}/{maxForRarity}`). An earlier version of this file modeled
 * a fictional 0-10 level with its own per-level shard-cost table, which
 * silently misread every raw count as a level and produced wrong "shards
 * needed" numbers. There is no per-level curve to model here — leveling
 * just consumes raw shards 1:1 up to the rarity's max.
 */

/** Shards still needed to take an attribute from `ownedCount` (raw, already-synthesized shards) to its rarity's max. */
export function getShardsNeededToMax(rarity: Shard["rarity"], ownedCount: number): number {
  const max = MAX_QUANTITIES[rarity] ?? 0;
  const owned = Math.max(0, Math.floor(ownedCount));
  return Math.max(0, max - owned);
}

/** Whether an attribute is already fully maxed for its rarity, given a raw owned/synthesized count. */
export function isAttributeMaxed(rarity: Shard["rarity"], ownedCount: number): boolean {
  const max = MAX_QUANTITIES[rarity] ?? 0;
  return ownedCount >= max;
}
