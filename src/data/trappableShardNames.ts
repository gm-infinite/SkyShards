import type { Data } from "../types/types";

/**
 * Display names (as they appear in fusion-data.json's `shards[].name`) of
 * shards that can be passively farmed with Huntraps, per the Hypixel Skyblock
 * wiki / community trap-location data. Matched case-insensitively against
 * shard.name so we don't depend on internal_id formatting.
 *
 * Note: "Burningsoul" is a trappable shard per the wiki but isn't present in
 * this app's fusion-data.json yet (not added to the game data source) — it's
 * listed here so it starts working automatically once the data file catches up.
 */
export const TRAPPABLE_SHARD_NAMES: string[] = [
  "Phanpyre",
  "Cod",
  "Phanflare",
  "Verdant",
  "Chill",
  "Birries",
  "Tadgang",
  "Coralot",
  "Mudworm",
  "Azure",
  "Mossybit",
  "Salmon",
  "Bambuleaf",
  "Ent",
  "Soul of the Alpha",
  "Mochibear",
  "Magma Slug",
  "Stridersurfer",
  "Invisibug",
  "Piranha",
  "Drowned",
  "Abyssal Lanternfish",
  "Silentdepth",
  "Thyst",
  "Snowfin",
  "Lumisquid",
  "Dreadwing",
  "Joydive",
  "Lava Flame",
  "Inferno Koi",
  "Shellwise",
  "XYZ",
  "Spike",
  "Burningsoul",
];

const trappableNameSet = new Set(TRAPPABLE_SHARD_NAMES.map((name) => name.toLowerCase()));

/** Resolves the trappable-name list against a loaded Data set's shard IDs. */
export function getTrappableShardIds(data: Data): Set<string> {
  const ids = new Set<string>();
  for (const [shardId, shard] of Object.entries(data.shards)) {
    if (trappableNameSet.has(shard.name.toLowerCase())) {
      ids.add(shardId);
    }
  }
  return ids;
}
