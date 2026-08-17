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

  // Guards against the worker resolving/erroring AND being cancelled at
  // (almost) the same time, and against a stray message arriving after
  // either has already happened — the promise below settles exactly once.
  let settled = false;
  let rejectFn: (reason: unknown) => void = () => {};

  const promise = new Promise<GlobalOptimizationResult>((resolve, reject) => {
    rejectFn = reject;

    worker.onmessage = (event: MessageEvent<WorkerOutMsg>) => {
      if (settled) return;
      const data = event.data;
      if (!data || !("type" in data)) return;

      if (data.type === "progress") {
        onProgress?.({ completed: data.completed, total: data.total });
      } else if (data.type === "result") {
        settled = true;
        worker.terminate();
        resolve(data.result);
      } else if (data.type === "error") {
        settled = true;
        worker.terminate();
        reject(new Error(data.message || "Optimization scan failed"));
      }
    };

    worker.onerror = (err) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(err instanceof ErrorEvent ? new Error(err.message) : new Error("Optimization scan failed"));
    };

    const startMsg: WorkerStartMsg = { type: "start", params, inventory, ownedAttributes, recipeOverrides };
    worker.postMessage(startMsg);
  });

  // Cancelling settles the promise too (rejected) instead of leaving it
  // pending forever — an unresolved promise keeps its whole closure chain
  // (including the worker reference) reachable in memory indefinitely.
  // Callers that track their own "cancelled" flag (as the Optimizations
  // panel does) will correctly ignore this rejection rather than surfacing
  // it as a real error.
  const cancel = () => {
    if (settled) return;
    settled = true;
    worker.terminate();
    rejectFn(new Error("Optimization scan cancelled"));
  };

  return { promise, cancel };
}
