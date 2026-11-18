import { Worker } from "node:worker_threads";

export function runPredictionSimulation(input, { timeoutMs = 30_000, workerUrl = new URL("./prediction-worker.js", import.meta.url) } = {}) {
  return new Promise((resolve, reject) => {
    // Do not inherit server --import hooks (metrics/persistence) or test arguments.
    const worker = new Worker(workerUrl, { workerData:input, execArgv:[], resourceLimits:{ maxOldGenerationSizeMb:256 } });
    let reports, failure;
    const timer = setTimeout(() => {
      failure = new Error("预测模拟超时，等待后台重试");
      void worker.terminate();
    }, timeoutMs);
    worker.once("message", (value) => { reports = value; });
    worker.once("error", (error) => { failure = error; });
    // Wait for exit before releasing the slot: never run two simulation workers.
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (failure || code !== 0 || !Array.isArray(reports) || reports.length !== input.samples) {
        reject(failure ?? new Error(`预测模拟未完成（${code}）`));
      } else resolve(reports);
    });
  });
}
