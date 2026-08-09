import { CalculationService } from "./calculationService";
import { InvCalculationService } from "./invCalculationService";
import { getShardsNeededToMax } from "../data/attributeLevelingCosts";
import { MAX_QUANTITIES } from "../constants";
import { getTrappableShardIds } from "../data/trappableShardNames";
import type { CalculationParams, Data, InventoryRecipeTree, RecipeOverride } from "../types/types";

const CHAMELEON_SHARD_ID = "L4";

/** Just the two numbers every downstream consumer here actually needs from a scenario. */
export interface ShoppingListScenario {
  totalQuantities: Map<string, number>;
  totalTime: number;
}

export interface MinMaxShoppingList {
  /** Best case: the one real chosen plan, but every eligible Crocodile fuse in it doubles. */
  min: ShoppingListScenario;
  /** Worst case: the same real chosen plan, but no Crocodile fuse in it doubles. */
  max: ShoppingListScenario;
  /** (2 * crocodileLevel)% weight on `min`, the rest on `max`. */
  blendedTotalTime: number;
  blendedTimePerShard: number;
  /** Weight (0-1) given to the min scenario, i.e. crocodileLevel's success chance. */
  successWeight: number;
  /** Inventory left over after the real plan claimed what it needed from the pool it was given. */
  remainingInventory?: Map<string, number>;
  /** How much of each shard the real plan drew from stock (method "inventory" nodes) instead of farming/crafting fresh — luck-independent, same for min and max since both replay the same tree. */
  inventoryUsage: Map<string, number>;
}

export interface ShardTimeEntry {
  shardId: string;
  name: string;
  /** Quantity of this shard the combined min-case shopping list still needs to farm directly. */
  quantity: number;
  /** Total time (hours) to farm that quantity at this shard's own rate. */
  totalGatherTime: number;
}

export interface ChameleonPriorityEntry extends ShardTimeEntry {
  /**
   * How many Chameleon Shards it would actually take to fully replace
   * farming this shard's whole remaining `quantity` via its chameleon
   * fusion recipe. This is a theoretical ceiling, not a suggestion to spend
   * that many — it's here so the ranking (by totalGatherTime) doesn't read
   * as "you need this many chameleons," which it isn't.
   */
  chameleonsForFullReplacement: number;
}

export interface ShortestToMaxEntry {
  shardId: string;
  name: string;
  rarity: string;
  /** Raw shards already synthesized into this attribute (not a 0-10 level). */
  ownedCount: number;
  /** MAX_QUANTITIES[rarity] — the raw shard count a fully maxed attribute of this rarity has. */
  maxCount: number;
  quantityNeeded: number;
  /** Blended (min/max crocodile) total time to acquire quantityNeeded of this shard. */
  blendedTime: number;
}

export interface ShoppingListRow {
  shardId: string;
  name: string;
  minQuantity: number;
  maxQuantity: number;
  minTime: number;
  maxTime: number;
  /** How much of this shard the plan is drawing from your existing stock instead of farming — don't farm this part again! */
  substitutedQuantity: number;
}

export interface ExcessInventoryEntry {
  shardId: string;
  name: string;
  quantity: number;
}

export interface GlobalOptimizationResult {
  /** Every unmaxed shard, fastest to max first. */
  shortestToMax: ShortestToMaxEntry[];
  /** Farm shopping list across ALL unmaxed shards combined, min & max scenarios merged. */
  shoppingRows: ShoppingListRow[];
  /** Trappable shards from the combined shopping list, ranked by total gather time. */
  trapPriority: ShardTimeEntry[];
  /** Chameleon-fusable shards from the combined shopping list, ranked by total gather time. */
  chameleonPriority: ChameleonPriorityEntry[];
  /** Sum of every candidate's blended total time (rough "everything left" estimate). */
  combinedBlendedTotalTime: number;
  candidateCount: number;
  /** What's left in your inventory after every unmaxed attribute has claimed what it needs, largest first. */
  excessInventory: ExcessInventoryEntry[];
}

export interface ScanProgress {
  completed: number;
  total: number;
}

function serializeMap(map: Map<string, number>): string {
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
}

export class ShardOptimizationService {
  private static instance: ShardOptimizationService;
  private calc = new CalculationService();
  private inv = InvCalculationService.getInstance();
  private globalCache: { key: string; promise: Promise<GlobalOptimizationResult> } | null = null;

  public static getInstance(): ShardOptimizationService {
    if (!ShardOptimizationService.instance) {
      ShardOptimizationService.instance = new ShardOptimizationService();
    }
    return ShardOptimizationService.instance;
  }

  /**
   * Runs the calculation ONCE with the player's real crocodileLevel — exactly
   * like the Calculator tab, which picks recipes/inventory usage based on the
   * real expected-value multiplier — then replays that *same* chosen plan
   * under its best-case (every eligible fuse doubles) and worst-case (none
   * do) outcomes, and blends the two totals by the real success chance.
   * This never re-optimizes into a different plan for min vs max; both are
   * the same recipe/inventory choices, just different luck.
   *
   * `inventory` is whatever pool this call is allowed to draw from — for a
   * single standalone lookup that's the player's full inventory, but callers
   * doing a multi-shard greedy scan can pass in a pool that's already been
   * partly spent by higher-priority shards. `remainingInventory` on the
   * result reports what's left after this call, to feed the next one.
   */
  async computeMinMaxShoppingList(
    targetShard: string,
    requiredQuantity: number,
    params: CalculationParams,
    inventory: Map<string, number>,
    recipeOverrides: RecipeOverride[] = [],
    ownedAttributes: Map<string, number> = new Map()
  ): Promise<MinMaxShoppingList> {
    const successWeight = Math.max(0, Math.min(100, 2 * params.crocodileLevel)) / 100;

    const real = await this.inv.calculateOptimalPath(targetShard, requiredQuantity, params, inventory, recipeOverrides, ownedAttributes);
    const inventoryUsage = real.tree ? this.collectInventoryUsage(real.tree) : new Map<string, number>();

    if (!real.tree) {
      const scenario: ShoppingListScenario = { totalQuantities: real.totalQuantities, totalTime: real.totalTime };
      return {
        min: scenario,
        max: scenario,
        blendedTotalTime: real.totalTime,
        blendedTimePerShard: 0,
        successWeight,
        remainingInventory: real.remainingInventory,
        inventoryUsage,
      };
    }

    const parsed = await this.calc.parseData(params);
    const { min, max } = this.inv.computeMinMaxFromTree(real.tree, requiredQuantity, parsed, params);

    const blendedTotalTime = successWeight * min.totalTime + (1 - successWeight) * max.totalTime;
    const blendedTimePerShard = requiredQuantity > 0 ? blendedTotalTime / requiredQuantity : 0;

    return { min, max, blendedTotalTime, blendedTimePerShard, successWeight, remainingInventory: real.remainingInventory, inventoryUsage };
  }

  /**
   * Walks a fixed tree and sums up how much of each shard came from
   * "inventory" (stock) nodes rather than being farmed or crafted fresh —
   * i.e. exactly the substitution amounts the greedy scan is relying on.
   * Independent of min/max luck since both replay the same tree structure.
   */
  private collectInventoryUsage(tree: InventoryRecipeTree, usage: Map<string, number> = new Map()): Map<string, number> {
    if (Array.isArray(tree)) {
      tree.forEach((node) => this.collectInventoryUsage(node, usage));
      return usage;
    }
    if (tree.method === "inventory") {
      usage.set(tree.shard, (usage.get(tree.shard) || 0) + tree.quantity);
    } else if (tree.method === "recipe") {
      this.collectInventoryUsage(tree.inputs[0], usage);
      this.collectInventoryUsage(tree.inputs[1], usage);
    } else if (tree.method === "cycle") {
      this.collectInventoryUsage(tree.inputRecipe, usage);
      tree.cycleInputs.forEach((node) => this.collectInventoryUsage(node, usage));
    }
    return usage;
  }

  /** Flattens combined min/max total-quantity maps into rows the UI can render directly. */
  computeShoppingListRows(minQuantities: Map<string, number>, maxQuantities: Map<string, number>, substitutedQuantities: Map<string, number>, data: Data): ShoppingListRow[] {
    const shardIds = new Set<string>([...minQuantities.keys(), ...maxQuantities.keys(), ...substitutedQuantities.keys()]);
    const rows: ShoppingListRow[] = [];

    for (const shardId of shardIds) {
      const shard = data.shards[shardId];
      if (!shard) continue;

      const unitTime = this.calc.getDirectCost(shard, false);
      if (!Number.isFinite(unitTime)) continue;

      const minQuantity = minQuantities.get(shardId) ?? 0;
      const maxQuantity = maxQuantities.get(shardId) ?? 0;
      const substitutedQuantity = substitutedQuantities.get(shardId) ?? 0;

      rows.push({
        shardId,
        name: shard.name,
        minQuantity,
        maxQuantity,
        minTime: unitTime * minQuantity,
        maxTime: unitTime * maxQuantity,
        substitutedQuantity,
      });
    }

    return rows.sort((a, b) => b.maxTime - a.maxTime);
  }

  /**
   * Ranks shards from a combined min-case shopping list by their own total
   * gather time (quantity needed x that shard's own farm rate), restricted
   * to shards matching `filter`. Shared implementation for both Trap
   * Priority (filter = trappable) and Chameleon Priority (filter =
   * chameleon-fusable): both boil down to "which shard costs the most time
   * to gather normally, among the ones this shortcut actually applies to."
   */
  private rankByGatherTime(minQuantities: Map<string, number>, data: Data, filter: (shardId: string) => boolean, limit: number): ShardTimeEntry[] {
    const entries: ShardTimeEntry[] = [];

    for (const [shardId, quantity] of minQuantities.entries()) {
      if (!filter(shardId)) continue;
      const shard = data.shards[shardId];
      if (!shard) continue;

      const unitTime = this.calc.getDirectCost(shard, false);
      if (!Number.isFinite(unitTime)) continue;

      entries.push({ shardId, name: shard.name, quantity, totalGatherTime: unitTime * quantity });
    }

    return entries.sort((a, b) => b.totalGatherTime - a.totalGatherTime).slice(0, limit);
  }

  /** Top trappable shards (by total gather time) from a combined min-case shopping list. */
  computeTrapPriorityList(minQuantities: Map<string, number>, data: Data, limit = 10): ShardTimeEntry[] {
    const trappableIds = getTrappableShardIds(data);
    return this.rankByGatherTime(minQuantities, data, (id) => trappableIds.has(id), limit);
  }

  /**
   * Top chameleon-fusable shards (by total gather time) from a combined
   * min-case shopping list. `quantity` here is how much of that shard is
   * still needed overall — NOT how many chameleons to use. See
   * `chameleonsForFullReplacement` for that number specifically.
   */
  computeChameleonPriorityList(minQuantities: Map<string, number>, data: Data, params: CalculationParams, limit = 10): ChameleonPriorityEntry[] {
    const { crocodileMultiplier } = this.calc.calculateMultipliers(params);
    const chameleonFuseAmount = data.shards[CHAMELEON_SHARD_ID]?.fuse_amount ?? 1;
    const entries: ChameleonPriorityEntry[] = [];

    for (const [shardId, quantity] of minQuantities.entries()) {
      const chameleonRecipes = (data.recipes[shardId] || []).filter((r) => r.inputs.includes(CHAMELEON_SHARD_ID));
      if (chameleonRecipes.length === 0) continue;

      const shard = data.shards[shardId];
      if (!shard) continue;

      const unitTime = this.calc.getDirectCost(shard, false);
      if (!Number.isFinite(unitTime)) continue;

      const bestOutputQty = Math.max(...chameleonRecipes.map((r) => this.calc.getEffectiveOutputQuantity(r, crocodileMultiplier)));
      const chameleonsForFullReplacement = bestOutputQty > 0 ? Math.ceil(quantity / bestOutputQty) * chameleonFuseAmount : 0;

      entries.push({
        shardId,
        name: shard.name,
        quantity,
        totalGatherTime: unitTime * quantity,
        chameleonsForFullReplacement,
      });
    }

    return entries.sort((a, b) => b.totalGatherTime - a.totalGatherTime).slice(0, limit);
  }

  /**
   * The main entry point: automatically scans every shard the player hasn't
   * maxed yet (no target shard needed), and returns the shortest-to-max
   * ranking plus a combined min/max shopping list, trap priority, and
   * chameleon priority across all of them at once.
   *
   * Results are cached and reused as long as params/inventory/attributes/
   * recipeOverrides haven't changed, since a full scan runs up to two
   * optimal-path calculations per unmaxed shard. `onProgress` is called
   * after each batch so the UI can show scan progress.
   */
  async computeGlobalOptimizations(
    params: CalculationParams,
    inventory: Map<string, number>,
    ownedAttributes: Map<string, number>,
    recipeOverrides: RecipeOverride[] = [],
    onProgress?: (progress: ScanProgress) => void
  ): Promise<GlobalOptimizationResult> {
    const cacheKey = JSON.stringify({
      params,
      inventory: serializeMap(inventory),
      ownedAttributes: serializeMap(ownedAttributes),
      recipeOverrides,
    });

    if (this.globalCache && this.globalCache.key === cacheKey) {
      return this.globalCache.promise;
    }

    const promise = this.computeGlobalOptimizationsUncached(params, inventory, ownedAttributes, recipeOverrides, onProgress);
    this.globalCache = { key: cacheKey, promise };
    return promise;
  }

  /** Drops the cached result so the next computeGlobalOptimizations call recomputes from scratch. */
  invalidateGlobalCache(): void {
    this.globalCache = null;
  }

  private async computeGlobalOptimizationsUncached(
    params: CalculationParams,
    inventory: Map<string, number>,
    ownedAttributes: Map<string, number>,
    recipeOverrides: RecipeOverride[],
    onProgress?: (progress: ScanProgress) => void
  ): Promise<GlobalOptimizationResult> {
    const data = await this.calc.parseData(params);

    // Cheap ranking pass: "longest to get" approximated by raw farm time
    // (quantity needed x that shard's own direct rate), just to decide
    // processing order below — no calculateOptimalPath needed yet.
    const ranked = Object.keys(data.shards)
      .map((shardId) => {
        const shard = data.shards[shardId];
        // ownedAttributes holds the RAW synthesized shard count (0..MAX_QUANTITIES[rarity]), not a 0-10 level.
        const ownedCount = ownedAttributes.get(shardId) ?? 0;

        const quantityNeeded = getShardsNeededToMax(shard.rarity, ownedCount);
        if (quantityNeeded <= 0) return null;

        const unitTime = this.calc.getDirectCost(shard, false);
        const rankTime = Number.isFinite(unitTime) ? unitTime * quantityNeeded : 0;

        return { shardId, shard, ownedCount, quantityNeeded, rankTime };
      })
      .filter((c): c is { shardId: string; shard: (typeof data.shards)[string]; ownedCount: number; quantityNeeded: number; rankTime: number } => c !== null)
      .sort((a, b) => b.rankTime - a.rankTime);

    const shortestToMax: ShortestToMaxEntry[] = [];
    const combinedMinQuantities = new Map<string, number>();
    const combinedMaxQuantities = new Map<string, number>();
    const combinedSubstitutedQuantities = new Map<string, number>();
    let combinedBlendedTotalTime = 0;

    // Greedy, longest-to-get first, ONE shared inventory pool that depletes
    // as we go: each candidate is calculated against whatever's left after
    // every higher-priority (longer) candidate already claimed its share, so
    // scarce inventory gets spent where it saves the most time instead of
    // every target independently assuming it has the full stockpile to
    // itself. This must run sequentially — each step depends on the last.
    let sharedInventory = new Map(inventory);

    for (let i = 0; i < ranked.length; i++) {
      const candidate = ranked[i];

      const list = await this.computeMinMaxShoppingList(
        candidate.shardId,
        candidate.quantityNeeded,
        params,
        sharedInventory,
        recipeOverrides,
        ownedAttributes
      );

      shortestToMax.push({
        shardId: candidate.shardId,
        name: candidate.shard.name,
        rarity: candidate.shard.rarity,
        ownedCount: candidate.ownedCount,
        maxCount: MAX_QUANTITIES[candidate.shard.rarity],
        quantityNeeded: candidate.quantityNeeded,
        blendedTime: list.blendedTotalTime,
      });
      combinedBlendedTotalTime += list.blendedTotalTime;

      for (const [id, qty] of list.min.totalQuantities.entries()) {
        combinedMinQuantities.set(id, (combinedMinQuantities.get(id) || 0) + qty);
      }
      for (const [id, qty] of list.max.totalQuantities.entries()) {
        combinedMaxQuantities.set(id, (combinedMaxQuantities.get(id) || 0) + qty);
      }
      for (const [id, qty] of list.inventoryUsage.entries()) {
        combinedSubstitutedQuantities.set(id, (combinedSubstitutedQuantities.get(id) || 0) + qty);
      }

      if (list.remainingInventory) {
        sharedInventory = list.remainingInventory;
      }

      onProgress?.({ completed: i + 1, total: ranked.length });
    }

    shortestToMax.sort((a, b) => a.blendedTime - b.blendedTime);

    const shoppingRows = this.computeShoppingListRows(combinedMinQuantities, combinedMaxQuantities, combinedSubstitutedQuantities, data);
    const trapPriority = this.computeTrapPriorityList(combinedMinQuantities, data, 10);
    const chameleonPriority = this.computeChameleonPriorityList(combinedMinQuantities, data, params, 10);

    // Whatever's left in the shared pool after every unmaxed attribute has
    // claimed what it needs — genuinely idle stock the plan never touched.
    const excessInventory: ExcessInventoryEntry[] = Array.from(sharedInventory.entries())
      .filter(([, qty]) => qty > 0)
      .map(([shardId, quantity]) => ({ shardId, name: data.shards[shardId]?.name ?? shardId, quantity }))
      .sort((a, b) => b.quantity - a.quantity);

    return {
      shortestToMax,
      shoppingRows,
      trapPriority,
      chameleonPriority,
      combinedBlendedTotalTime,
      candidateCount: ranked.length,
      excessInventory,
    };
  }
}
