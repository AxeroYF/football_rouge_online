import { parentPort, workerData } from "node:worker_threads";
import { runS4BalanceReport } from "./s4-balance-report.js";

try {
  const report = await runS4BalanceReport(workerData.config, { includeInternalAggregate:true });
  parentPort.postMessage({
    taskId:workerData.taskId,
    kind:workerData.kind,
    experimentKey:workerData.experimentKey ?? null,
    internalAggregate:report.internalAggregate,
    experiments:report.experiments,
    rawMatchSamples:report.rawMatchSamples,
  });
} catch (error) {
  parentPort.postMessage({ taskId:workerData.taskId, error:{ name:error.name, message:error.message, stack:error.stack } });
}
