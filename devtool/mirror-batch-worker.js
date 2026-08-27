import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";
import {
  MIRROR_BATCH_DIRECTOR_CONCURRENCY,
  MIRROR_BATCH_WORKER_ENGINE_VERSION,
  runMirrorBatchWorkerMatch,
} from "../versus/mirror-batch-worker-protocol.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function workerConfiguration(source = process.env) {
  const baseUrl = String(source.YDL_MIRROR_WORKER_URL ?? "").replace(/\/+$/, "");
  const token = String(source.YDL_MIRROR_WORKER_TOKEN ?? "");
  const workerId = String(source.YDL_MIRROR_WORKER_ID ?? "axero-director-pc").trim();
  const concurrency = Math.min(MIRROR_BATCH_DIRECTOR_CONCURRENCY, Math.max(1, Number(source.YDL_MIRROR_WORKER_CONCURRENCY ?? MIRROR_BATCH_DIRECTOR_CONCURRENCY)));
  const acceptingJobs = !["0", "false", "off", "no"].includes(String(source.YDL_MIRROR_WORKER_ACCEPT_JOBS ?? "true").trim().toLowerCase());
  if (!/^https?:\/\//i.test(baseUrl)) throw new Error("YDL_MIRROR_WORKER_URL must be an HTTP(S) server URL");
  if (!token) throw new Error("YDL_MIRROR_WORKER_TOKEN is required");
  if (!workerId) throw new Error("YDL_MIRROR_WORKER_ID is required");
  return { baseUrl, token, workerId, concurrency, acceptingJobs };
}

async function workerRequest(configuration, action, body) {
  const response = await fetch(`${configuration.baseUrl}/api/worker/mirror-batches/${action}`, {
    method:"POST",
    headers:{ authorization:`Bearer ${configuration.token}`, "content-type":"application/json" },
    body:JSON.stringify(body),
    signal:AbortSignal.timeout(60_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok || !value.ok) {
    const error = new Error(value.error ?? `worker API ${action} failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

async function runSlot(configuration, slot) {
  for (;;) {
    let job = null;
    let reports = [];
    try {
      const leased = await workerRequest(configuration, "lease", {
        workerId:configuration.workerId,
        engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
      });
      job = leased.job;
      if (!job) {
        await sleep(3_000);
        continue;
      }
      parentPort.postMessage({ type:"lease-start", slot, leaseId:job.leaseId, jobId:job.jobId });
      for (const specification of job.matches) {
        reports.push(runMirrorBatchWorkerMatch(job, specification));
        await workerRequest(configuration, "progress", {
          workerId:configuration.workerId,
          engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
          jobId:job.jobId,
          leaseId:job.leaseId,
          completedMatches:reports.length,
        });
      }
      await workerRequest(configuration, "complete", {
        workerId:configuration.workerId,
        engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
        jobId:job.jobId,
        leaseId:job.leaseId,
        reports,
      });
      parentPort.postMessage({ type:"job-complete", slot, leaseId:job.leaseId, jobId:job.jobId });
    } catch (error) {
      if (job?.leaseId) {
        await workerRequest(configuration, "fail", {
          workerId:configuration.workerId,
          engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
          jobId:job.jobId,
          leaseId:job.leaseId,
          error:error.message,
        }).catch(() => {});
      }
      parentPort.postMessage({ type:"slot-error", slot, leaseId:job?.leaseId ?? null, jobId:job?.jobId ?? null, error:error.message });
      await sleep(5_000);
    } finally {
      if (job?.leaseId) parentPort.postMessage({ type:"lease-end", slot, leaseId:job.leaseId, jobId:job.jobId });
      // A portable node never writes match data to disk. Explicitly release the
      // large seats, match specifications and reports after every lease so a
      // long-running friend node does not retain completed batches in memory.
      reports.length = 0;
      if (job) {
        if (Array.isArray(job.matches)) job.matches.length = 0;
        delete job.callerSeat;
        delete job.opponentSeat;
      }
      reports = [];
      job = null;
    }
  }
}

if (isMainThread) {
  const configuration = workerConfiguration();
  const activeLeaseIds = new Set();
  const heartbeat = async () => {
    const value = await workerRequest(configuration, "heartbeat", {
      workerId:configuration.workerId,
      engineVersion:MIRROR_BATCH_WORKER_ENGINE_VERSION,
      maximumConcurrency:configuration.concurrency,
      activeLeaseIds:[...activeLeaseIds],
      acceptingJobs:configuration.acceptingJobs,
    });
    return value.worker;
  };
  const status = await heartbeat();
  console.log(configuration.acceptingJobs
    ? `玩家计算节点已连接并接受任务：${configuration.workerId}，${configuration.concurrency}个槽位，空闲${status.availableSlots}/${status.capacity}`
    : `玩家计算节点已连接：${configuration.workerId}，当前为在线待机，不领取新任务`);
  const heartbeatTimer = setInterval(() => heartbeat().catch((error) => console.error("高速Worker心跳失败：", error.message)), 15_000);
  if (configuration.acceptingJobs) heartbeatTimer.unref();
  for (let slot = 1; slot <= (configuration.acceptingJobs ? configuration.concurrency : 0); slot += 1) {
    const worker = new Worker(new URL(import.meta.url), { workerData:{ configuration, slot } });
    worker.on("message", (message) => {
      if (message.type === "lease-start") activeLeaseIds.add(message.leaseId);
      if (message.type === "lease-end") activeLeaseIds.delete(message.leaseId);
      if (message.type === "job-complete") console.log(`槽位${message.slot}完成任务 ${message.jobId}`);
      if (message.type === "slot-error") console.error(`槽位${message.slot}失败：${message.error}`);
    });
    worker.on("error", (error) => console.error(`槽位${slot}线程错误：`, error));
    worker.on("exit", (code) => { if (code !== 0) console.error(`槽位${slot}意外退出，代码${code}`); });
  }
} else {
  runSlot(workerData.configuration, workerData.slot).catch((error) => {
    parentPort.postMessage({ type:"slot-error", slot:workerData.slot, error:error.message });
    process.exitCode = 1;
  });
}
