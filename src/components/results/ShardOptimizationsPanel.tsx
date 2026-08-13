import React, { useEffect, useState } from "react";
import { Crosshair, Sparkles, Timer, Loader2, ListChecks, RefreshCw, PackageOpen } from "lucide-react";
import { formatTime, getRarityColor } from "../../utilities";
import { ShardOptimizationService } from "../../services";
import type { GlobalOptimizationResult, ScanProgress } from "../../services";
import type { CalculationParams, RecipeOverride } from "../../types/types";

interface ShardOptimizationsPanelProps {
  params: CalculationParams;
  inventory: Map<string, number>;
  ownedAttributes: Map<string, number>;
  recipeOverrides: RecipeOverride[];
}

type TabKey = "shopping" | "trap" | "chameleon" | "shortest" | "excess";

const TABS: { key: TabKey; label: string; icon: React.ElementType }[] = [
  { key: "shopping", label: "Min / Max List", icon: ListChecks },
  { key: "trap", label: "Trap Priority", icon: Crosshair },
  { key: "chameleon", label: "Chameleon Priority", icon: Sparkles },
  { key: "shortest", label: "Shortest to Max", icon: Timer },
  { key: "excess", label: "Excess Inventory", icon: PackageOpen },
];

const ShardIcon: React.FC<{ shardId: string; name: string }> = ({ shardId, name }) => (
  <img
    src={`${import.meta.env.BASE_URL}shardIcons/${shardId}.png`}
    alt={name}
    className="w-5 h-5 object-contain flex-shrink-0 inline-block align-middle mr-2"
    loading="lazy"
  />
);

export const ShardOptimizationsPanel: React.FC<ShardOptimizationsPanelProps> = ({ params, inventory, ownedAttributes, recipeOverrides }) => {
  const shardOptimizationService = ShardOptimizationService.getInstance();
  const [activeTab, setActiveTab] = useState<TabKey>("shopping");
  const [result, setResult] = useState<GlobalOptimizationResult | null>(null);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProgress(null);
    shardOptimizationService
      .computeGlobalOptimizations(params, inventory, ownedAttributes, recipeOverrides, (p) => !cancelled && setProgress(p))
      .then((res) => !cancelled && setResult(res))
      .catch((err) => console.error("Global optimization scan failed:", err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // refreshToken lets the "Rescan" button force a recompute even if inputs are unchanged
  }, [params, inventory, ownedAttributes, recipeOverrides, refreshToken, shardOptimizationService]);

  const handleRescan = () => {
    shardOptimizationService.invalidateGlobalCache();
    setRefreshToken((t) => t + 1);
  };

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-md p-3">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1 bg-slate-700 rounded-md">
            <Sparkles className="w-5 h-5 text-fuchsia-400" />
          </div>
          <h3 className="text-lg font-semibold text-white">Grind Optimizations</h3>
        </div>
        <button
          onClick={handleRescan}
          disabled={loading}
          className="px-2 py-1 text-xs rounded-md border border-slate-600 text-slate-300 hover:border-slate-500 flex items-center gap-1 flex-shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          title="Recompute from scratch (results are otherwise cached until your inventory, attributes, or settings change)"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} />
          Rescan
        </button>
      </div>

      <p className="text-xs text-slate-400 mb-3">
        Automatically scans every shard attribute you haven't maxed yet — no target selection needed. Results are cached
        until your inventory, attribute levels, or calculator settings change.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-slate-400 text-sm py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          {progress ? `Scanning shards (${progress.completed}/${progress.total})...` : "Scanning shards..."}
        </div>
      )}

      {!loading && result && result.candidateCount === 0 && (
        <div className="text-slate-400 text-sm py-3">
          Every shard in your imported attributes is already maxed — nothing left to optimize! Import your inventory/attributes if
          this looks wrong.
        </div>
      )}

      {!loading && result && result.candidateCount > 0 && (
        <>
          <div className="flex gap-2 flex-wrap mb-3">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-3 py-1.5 font-medium rounded-md text-xs transition-colors duration-200 flex items-center gap-1.5 cursor-pointer border ${
                  activeTab === key
                    ? "bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30"
                    : "bg-slate-700/50 text-slate-300 border-slate-600 hover:border-slate-500"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-400 mb-2">
            {result.candidateCount} unmaxed shards scanned • blended total time:{" "}
            <span className="text-white font-medium">{formatTime(result.combinedBlendedTotalTime)}</span>
          </div>

          {activeTab === "shopping" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Every shard you still need to farm directly to max every attribute, combined across all of them — in both
                extremes: <span className="text-white">min</span> assumes every Crocodile fuse doubles, <span className="text-white">max</span>{" "}
                assumes none do. <span className="text-white">From Stock</span> is how much of that shard the plan is already
                covering from your inventory elsewhere in the tree — don't farm that part again.
              </p>
              {result.shoppingRows.length === 0 ? (
                <EmptyRow text="Nothing left to farm — your inventory covers everything." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-400 text-xs text-left">
                        <th className="font-medium pb-1.5 pl-1">Shard</th>
                        <th className="font-medium pb-1.5 text-right">Min Qty</th>
                        <th className="font-medium pb-1.5 text-right">Max Qty</th>
                        <th className="font-medium pb-1.5 text-right">From Stock</th>
                        <th className="font-medium pb-1.5 text-right pr-1">Min → Max Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.shoppingRows.map((row) => (
                        <tr key={row.shardId} className="border-t border-slate-700/60">
                          <td className="py-1.5 pl-1">
                            <div className="flex items-center min-w-0">
                              <ShardIcon shardId={row.shardId} name={row.name} />
                              <span className="text-white truncate">{row.name}</span>
                            </div>
                          </td>
                          <td className="py-1.5 text-right text-slate-300">{Math.ceil(row.minQuantity)}x</td>
                          <td className="py-1.5 text-right text-slate-300">{Math.ceil(row.maxQuantity)}x</td>
                          <td className="py-1.5 text-right">
                            {row.substitutedQuantity > 0 ? (
                              <span className="text-emerald-400 font-medium">{Math.floor(row.substitutedQuantity)}x</span>
                            ) : (
                              <span className="text-slate-600">—</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right pr-1 text-fuchsia-300 font-medium whitespace-nowrap">
                            {formatTime(row.minTime)} → {formatTime(row.maxTime)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {activeTab === "trap" && (
            <PriorityList
              description="Top 10 shards across your whole remaining grind that can be passively farmed with Huntraps, ranked by total gather time — the ones most worth leaving a trap running for."
              entries={result.trapPriority}
              emptyText="No trappable shards show up in your combined shopping list."
            />
          )}

          {activeTab === "chameleon" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Top 10 shards across your whole remaining grind that have a Chameleon fusion recipe, ranked by how long each
                normally takes to farm. <span className="text-white">Needed qty</span> is how much of that shard you still
                need overall (not a chameleon count) — <span className="text-white">chameleons to fully replace</span> is the
                actual number of Chameleon Shards it'd take to skip farming all of it, which is usually far more than you
                own. Use this to decide where the few chameleons you have go furthest, not as a shopping target.
              </p>
              {result.chameleonPriority.length === 0 ? (
                <EmptyRow text="No shard in your combined shopping list has a chameleon fusion recipe." />
              ) : (
                <ol className="space-y-1.5">
                  {result.chameleonPriority.map((entry, i) => (
                    <li
                      key={entry.shardId}
                      className="bg-slate-700/50 border border-slate-600/60 rounded-md px-3 py-2 flex items-center justify-between"
                    >
                      <div className="flex items-center min-w-0">
                        <span className="text-slate-500 text-xs w-5 flex-shrink-0">{i + 1}.</span>
                        <ShardIcon shardId={entry.shardId} name={entry.name} />
                        <div className="min-w-0">
                          <span className="text-white text-sm truncate block">{entry.name}</span>
                          <span className="text-slate-400 text-xs">
                            {Math.ceil(entry.quantity)}x needed • {entry.chameleonsForFullReplacement}x chameleons to fully replace
                          </span>
                        </div>
                      </div>
                      <span className="text-fuchsia-300 text-sm font-medium flex-shrink-0 ml-2">{formatTime(entry.totalGatherTime)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {activeTab === "shortest" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-400">
                Every unmaxed attribute, fastest to max first — blended min/max time using your own recipe/inventory setup.{" "}
                <span className="text-emerald-400">Uses N from stock</span> means part of that plan is already covered by your
                inventory instead of being farmed — see the Excess Inventory tab for exactly where.
              </p>
              <ol className="space-y-1.5">
                {result.shortestToMax.map((entry, i) => (
                  <li key={entry.shardId} className="bg-slate-700/50 border border-slate-600/60 rounded-md px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center min-w-0">
                      <span className="text-slate-500 text-xs w-5 flex-shrink-0">{i + 1}.</span>
                      <ShardIcon shardId={entry.shardId} name={entry.name} />
                      <div className="min-w-0">
                        <span className={`text-sm truncate block ${getRarityColor(entry.rarity)}`}>{entry.name}</span>
                        <span className="text-slate-500 text-xs">
                          {entry.ownedCount}/{entry.maxCount} shards • {entry.quantityNeeded} more needed
                          {entry.substitutedCount > 0 && <span className="text-emerald-400"> • uses {Math.floor(entry.substitutedCount)} from stock</span>}
                        </span>
                      </div>
                    </div>
                    <span className="text-fuchsia-300 text-sm font-medium flex-shrink-0 ml-2">{formatTime(entry.blendedTime)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}

          {activeTab === "excess" && (
            <div className="space-y-5">
              {/* Section 1: what's actually being substituted right now */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wide">Used — already substituted into your plan</h4>
                <p className="text-xs text-slate-400">
                  Ranked by how much farming this is saving you. Processed longest-to-get shard first, so your stock goes to the
                  biggest grinds before anything else. The same shard used toward two different recipes shows as two separate
                  rows.
                </p>
                {result.substitutionsUsed.length === 0 ? (
                  <EmptyRow text="No stock substitution is happening yet — nothing in your inventory overlaps with what your plan currently needs." />
                ) : (
                  <ol className="space-y-1.5">
                    {result.substitutionsUsed.map((entry, i) => (
                      <li
                        key={`${entry.substituteShardId}::${entry.usedInShardId}`}
                        className="bg-slate-700/50 border border-slate-600/60 rounded-md px-3 py-2 flex items-center justify-between"
                      >
                        <div className="flex items-center min-w-0">
                          <span className="text-slate-500 text-xs w-5 flex-shrink-0">{i + 1}.</span>
                          <ShardIcon shardId={entry.substituteShardId} name={entry.substituteName} />
                          <div className="min-w-0">
                            <span className="text-white text-sm truncate block">
                              {Math.floor(entry.quantity)}x {entry.substituteName}
                            </span>
                            <span className="text-slate-400 text-xs">used toward {entry.usedInName}</span>
                          </div>
                        </div>
                        <span className="text-emerald-400 text-sm font-medium flex-shrink-0 ml-2">{formatTime(entry.timeValue)} saved</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Section 2: idle excess that COULD be used if a recipe were switched */}
              <div className="space-y-2 border-t border-slate-700/60 pt-4">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wide">Suggested — not applied yet</h4>
                <p className="text-xs text-slate-400">
                  Idle excess that has a valid recipe for something you still need, which the planner isn't using because it
                  picked a different ingredient by raw farm cost. Switching would use up the excess instead of farming more —
                  these are estimates, not auto-applied, and don't all stack if they share the same excess shard.
                </p>
                {result.excessSubstitutionSuggestions.length === 0 ? (
                  <EmptyRow text="No unused-but-usable substitutions found for your current excess." />
                ) : (
                  <ol className="space-y-1.5">
                    {result.excessSubstitutionSuggestions.map((entry, i) => (
                      <li
                        key={`${entry.excessShardId}::${entry.targetShardId}::${entry.replacesShardId}`}
                        className="bg-slate-700/50 border border-slate-600/60 rounded-md px-3 py-2 flex items-center justify-between"
                      >
                        <div className="flex items-center min-w-0">
                          <span className="text-slate-500 text-xs w-5 flex-shrink-0">{i + 1}.</span>
                          <ShardIcon shardId={entry.excessShardId} name={entry.excessName} />
                          <div className="min-w-0">
                            <span className="text-white text-sm truncate block">
                              Use {entry.craftsUsable}x {entry.excessName} in {entry.targetName}
                            </span>
                            <span className="text-slate-400 text-xs">
                              instead of farming {entry.replacesName} • covers {Math.floor(entry.quantityOfTargetCovered)}x {entry.targetName}
                            </span>
                          </div>
                        </div>
                        <span className="text-fuchsia-300 text-sm font-medium flex-shrink-0 ml-2">~{formatTime(entry.timeSaved)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              {/* Section 3: genuinely unused leftover, no known use found */}
              <div className="space-y-2 border-t border-slate-700/60 pt-4">
                <h4 className="text-xs font-semibold text-white uppercase tracking-wide">Unused — no use found</h4>
                <p className="text-xs text-slate-400">
                  Left over after everything above, with no matching recipe found for anything you still need.
                </p>
                {result.excessInventory.length === 0 ? (
                  <EmptyRow text="Nothing left over — your inventory is fully spoken for by your remaining grind." />
                ) : (
                  <ol className="space-y-1.5">
                    {result.excessInventory.map((entry) => (
                      <li
                        key={entry.shardId}
                        className="bg-slate-700/50 border border-slate-600/60 rounded-md px-3 py-2 flex items-center justify-between"
                      >
                        <div className="flex items-center min-w-0">
                          <ShardIcon shardId={entry.shardId} name={entry.name} />
                          <span className="text-white text-sm truncate">{entry.name}</span>
                        </div>
                        <span className="text-slate-400 text-sm font-medium flex-shrink-0 ml-2">{Math.floor(entry.quantity)}x unused</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

const PriorityList: React.FC<{
  description: string;
  entries: { shardId: string; name: string; quantity: number; totalGatherTime: number }[];
  emptyText: string;
}> = ({ description, entries, emptyText }) => (
  <div className="space-y-2">
    <p className="text-xs text-slate-400">{description}</p>
    {entries.length === 0 ? (
      <EmptyRow text={emptyText} />
    ) : (
      <ol className="space-y-1.5">
        {entries.map((entry, i) => (
          <li key={entry.shardId} className="bg-slate-700/50 border border-slate-600/60 rounded-md px-3 py-2 flex items-center justify-between">
            <div className="flex items-center min-w-0">
              <span className="text-slate-500 text-xs w-5 flex-shrink-0">{i + 1}.</span>
              <ShardIcon shardId={entry.shardId} name={entry.name} />
              <span className="text-white text-sm truncate">{entry.name}</span>
              <span className="text-slate-400 text-xs ml-2 flex-shrink-0">{Math.ceil(entry.quantity)}x needed</span>
            </div>
            <span className="text-fuchsia-300 text-sm font-medium flex-shrink-0 ml-2">{formatTime(entry.totalGatherTime)}</span>
          </li>
        ))}
      </ol>
    )}
  </div>
);

const EmptyRow: React.FC<{ text: string }> = ({ text }) => <div className="text-slate-400 text-sm py-2">{text}</div>;
