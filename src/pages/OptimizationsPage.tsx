import React, { useState, useEffect, useCallback } from "react";
import { Sparkles, Package } from "lucide-react";
import { useCalculatorState, useCustomRates } from "../hooks";
import { buildCalculationParams } from "../services";
import { ShardOptimizationsPanel, InventoryManagementModal } from "../components";
import { loadInventory, saveInventory, loadOwnedAttributes, saveOwnedAttributes, loadDisabledShards, saveDisabledShards } from "../utilities";
import type { CalculationParams } from "../types/types";

export const OptimizationsPage: React.FC = () => {
  const { form, setForm } = useCalculatorState();
  const { customRates } = useCustomRates();

  const [inventory, setInventory] = useState<Map<string, number>>(loadInventory);
  const [ownedAttributes, setOwnedAttributes] = useState<Map<string, number>>(loadOwnedAttributes);
  const [disabledShards, setDisabledShards] = useState<Set<string>>(loadDisabledShards);
  const [showInventoryModal, setShowInventoryModal] = useState(false);

  const [params, setParams] = useState<CalculationParams | null>(null);

  useEffect(() => {
    saveInventory(inventory);
  }, [inventory]);
  useEffect(() => {
    saveOwnedAttributes(ownedAttributes);
  }, [ownedAttributes]);
  useEffect(() => {
    saveDisabledShards(disabledShards);
  }, [disabledShards]);

  // Build CalculationParams the same way the Calculator page does, from the same settings.
  useEffect(() => {
    let cancelled = false;
    buildCalculationParams(form, customRates)
      .then((nextParams) => !cancelled && setParams(nextParams))
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [form, customRates]);

  const effectiveInventory = React.useMemo(() => new Map([...inventory].filter(([id]) => !disabledShards.has(id))), [inventory, disabledShards]);

  const handleShardLevelsImport = useCallback(
    (levels: Partial<Pick<typeof form, "newtLevel" | "salamanderLevel" | "lizardKingLevel" | "leviathanLevel" | "pythonLevel" | "kingCobraLevel" | "seaSerpentLevel" | "tiamatLevel" | "crocodileLevel">>) => {
      setForm({ ...form, ...levels });
    },
    [form, setForm]
  );

  return (
    <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-fuchsia-400" />
            Grind Optimizations
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Automatically scans every unmaxed attribute in your imported inventory — trap priority, chameleon priority, and shortest-to-max.
          </p>
        </div>
        <button
          onClick={() => setShowInventoryModal(true)}
          className="px-3 py-2 font-medium rounded-md text-sm transition-colors duration-200 flex items-center gap-2 cursor-pointer bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/20 hover:border-emerald-500/30"
        >
          <Package className="w-4 h-4" />
          Manage Inventory
          {inventory.size > 0 && <span className="text-emerald-200/70">({inventory.size})</span>}
        </button>
      </div>

      {inventory.size === 0 ? (
        <div className="text-center py-10 bg-white/5 border border-white/10 rounded-md">
          <div className="max-w-md mx-auto space-y-3">
            <div className="w-12 h-12 bg-fuchsia-500/20 border border-fuchsia-500/20 rounded-md flex items-center justify-center mx-auto">
              <Package className="w-6 h-6 text-fuchsia-400" />
            </div>
            <h3 className="text-lg font-medium text-white">Import your inventory to get started</h3>
            <p className="text-slate-400 text-sm mt-1">These tools need your owned shards and attribute levels to compute anything useful.</p>
            <button
              onClick={() => setShowInventoryModal(true)}
              className="px-4 py-2 font-medium rounded-md text-sm bg-fuchsia-500/20 hover:bg-fuchsia-500/30 text-fuchsia-300 border border-fuchsia-500/20 hover:border-fuchsia-500/30 cursor-pointer"
            >
              Manage Inventory
            </button>
          </div>
        </div>
      ) : (
        params && <ShardOptimizationsPanel params={params} inventory={effectiveInventory} ownedAttributes={ownedAttributes} recipeOverrides={[]} />
      )}

      <InventoryManagementModal
        open={showInventoryModal}
        onClose={() => setShowInventoryModal(false)}
        inventory={inventory}
        ownedAttributes={ownedAttributes}
        onInventoryChange={setInventory}
        onOwnedAttributesChange={setOwnedAttributes}
        disabledShards={disabledShards}
        onDisabledShardsChange={setDisabledShards}
        onShardLevelsImport={handleShardLevelsImport}
      />
    </div>
  );
};
