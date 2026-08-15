import type { GlobalOptimizationResult, ScanProgress } from "./shardOptimizationService";
import type { CalculationParams, RecipeOverride } from "../types/types";

type WorkerOutMsg =
  | { type: "progress"; completed: number; total: number }
  | { type: "result"; result: GlobalOptimizationResult }
  | { type: "error"; message: string };

type WorkerStartMsg = {
  type: "start";
  params: CalculationParams;
  inventory: Map<string, number>;
  ownedAttributes: Map<string, number>;
  recipeOverrides: RecipeOverride[];
};

/**
 * Runs the full unmaxed-shard optimization scan on a background thread
 * instead of blocking the UI — a full scan can run up to two optimal-path
 * calculations per unmaxed shard, sequentially (the greedy shared-inventory
 * pass can't be parallelized), which is exactly the kind of work that
 * shouldn't tie up the main thread. Mirrors the existing
 * `calculateOptimalPathWithWorker` pattern used for the Calculator tab.
 */
export function computeGlobalOptimizationsWithWorker(
  params: CalculationParams,
  inventory: Map<string, number>,
  ownedAttributes: Map<string, number>,
  recipeOverrides: RecipeOverride[] = [],
  onProgress?: (progress: ScanProgress) => void
): { promise: Promise<GlobalOptimizationResult>; cancel: () => void } {
  const worker = new Worker(new URL("../workers/shardOptimizationWorker.ts", import.meta.url), { type: "module" });

  const promise = new Promise<GlobalOptimizationResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerOutMsg>) => {
      const data = event.data;
      if (!data || !("type" in data)) return;

      if (data.type === "progress") {
        onProgress?.({ completed: data.completed, total: data.total });
      } else if (data.type === "result") {
        worker.terminate();
        resolve(data.result);
      } else if (data.type === "error") {
        worker.terminate();
        reject(new Error(data.message || "Optimization scan failed"));
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(err instanceof ErrorEvent ? new Error(err.message) : new Error("Optimization scan failed"));
    };

    const startMsg: WorkerStartMsg = { type: "start", params, inventory, ownedAttributes, recipeOverrides };
    worker.postMessage(startMsg);
  });

  const cancel = () => worker.terminate();

  return { promise, cancel };
}
