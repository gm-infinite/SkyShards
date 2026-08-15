import { ShardOptimizationService } from "../services/shardOptimizationService";
import type { GlobalOptimizationResult, ScanProgress } from "../services/shardOptimizationService";
import type { CalculationParams, RecipeOverride } from "../types/types";

interface StartMsg {
  type: "start";
  params: CalculationParams;
  inventory: Map<string, number>;
  ownedAttributes: Map<string, number>;
  recipeOverrides: RecipeOverride[];
}

interface ProgressMsg {
  type: "progress";
  completed: number;
  total: number;
}
interface ResultMsg {
  type: "result";
  result: GlobalOptimizationResult;
}
interface ErrorMsg {
  type: "error";
  message: string;
}

type OutMsg = ProgressMsg | ResultMsg | ErrorMsg;

const post = (msg: OutMsg) => (postMessage as (m: OutMsg) => void)(msg);

self.onmessage = async (e: MessageEvent<StartMsg>) => {
  const data = e.data;
  if (!data || data.type !== "start") return;

  try {
    const service = ShardOptimizationService.getInstance();
    const result = await service.computeGlobalOptimizations(
      data.params,
      data.inventory,
      data.ownedAttributes,
      data.recipeOverrides,
      (progress: ScanProgress) => post({ type: "progress", completed: progress.completed, total: progress.total })
    );
    post({ type: "result", result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Optimization scan failed";
    post({ type: "error", message });
  }
};
