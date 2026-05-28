import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import {
  QUEUE_NAME,
  SCI_CONSOLIDADO_QUEUE_NAME,
  SPED_MERGE_QUEUE_NAME,
  SPED_MERGE_INSPECT_QUEUE_NAME,
  SPED_QUEUE_NAME,
  COMPARACAO_PLANILHAS_QUEUE_NAME,
  COMPARACAO_NFSE_QUEUE_NAME,
  GNRE_QUEUE_NAME,
  SCI_PORTAL_NACIONAL_QUEUE_NAME,
  type SciConsolidadoJobPayload,
  type SpedJobPayload,
  type SpedMergeJobPayload,
  type SpedMergeInspectJobPayload,
  type ComparacaoPlanilhasJobPayload,
  type ComparacaoNfseJobPayload,
  type GnreJobPayload,
  type SciPortalNacionalJobPayload,
} from "@webapp/contracts";
import type { Env } from "./env.js";

export type NfeJobPayload = {
  jobId: string;
  xmlPaths: string[];
  outputPath: string;
};

export type {
  SciConsolidadoJobPayload,
  SpedJobPayload,
  SpedMergeJobPayload,
  SpedMergeInspectJobPayload,
  ComparacaoPlanilhasJobPayload,
  ComparacaoNfseJobPayload,
  GnreJobPayload,
  SciPortalNacionalJobPayload,
};

let connection: Redis | null = null;
let queue: Queue<NfeJobPayload> | null = null;
let spedQueue: Queue<SpedJobPayload> | null = null;
let spedMergeQueue: Queue<SpedMergeJobPayload> | null = null;
let spedMergeInspectQueue: Queue<SpedMergeInspectJobPayload> | null = null;
let spedMergeInspectEvents: QueueEvents | null = null;
let sciConsolidadoQueue: Queue<SciConsolidadoJobPayload> | null = null;
let comparacaoPlanilhasQueue: Queue<ComparacaoPlanilhasJobPayload> | null = null;
let comparacaoNfseQueue: Queue<ComparacaoNfseJobPayload> | null = null;
let gnreQueue: Queue<GnreJobPayload> | null = null;
let sciPortalNacionalQueue: Queue<SciPortalNacionalJobPayload> | null = null;

export function getRedis(env: Env): Redis {
  if (!connection) {
    connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      connectTimeout: 5_000,
    });
  }
  return connection;
}

export function getQueue(env: Env): Queue<NfeJobPayload> {
  if (!queue) {
    queue = new Queue<NfeJobPayload>(QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return queue;
}

export function getSpedQueue(env: Env): Queue<SpedJobPayload> {
  if (!spedQueue) {
    spedQueue = new Queue<SpedJobPayload>(SPED_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return spedQueue;
}

export function getSpedMergeQueue(env: Env): Queue<SpedMergeJobPayload> {
  if (!spedMergeQueue) {
    spedMergeQueue = new Queue<SpedMergeJobPayload>(SPED_MERGE_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return spedMergeQueue;
}

export function getSpedMergeInspectQueue(env: Env): Queue<SpedMergeInspectJobPayload> {
  if (!spedMergeInspectQueue) {
    spedMergeInspectQueue = new Queue<SpedMergeInspectJobPayload>(SPED_MERGE_INSPECT_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 50, age: 60 },
        removeOnFail: { count: 50, age: 300 },
      },
    });
  }
  return spedMergeInspectQueue;
}

export function getSpedMergeInspectEvents(env: Env): QueueEvents {
  if (!spedMergeInspectEvents) {
    spedMergeInspectEvents = new QueueEvents(SPED_MERGE_INSPECT_QUEUE_NAME, {
      connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return spedMergeInspectEvents;
}

export function getSciConsolidadoQueue(env: Env): Queue<SciConsolidadoJobPayload> {
  if (!sciConsolidadoQueue) {
    sciConsolidadoQueue = new Queue<SciConsolidadoJobPayload>(SCI_CONSOLIDADO_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return sciConsolidadoQueue;
}

export function getComparacaoPlanilhasQueue(env: Env): Queue<ComparacaoPlanilhasJobPayload> {
  if (!comparacaoPlanilhasQueue) {
    comparacaoPlanilhasQueue = new Queue<ComparacaoPlanilhasJobPayload>(COMPARACAO_PLANILHAS_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return comparacaoPlanilhasQueue;
}

export function getComparacaoNfseQueue(env: Env): Queue<ComparacaoNfseJobPayload> {
  if (!comparacaoNfseQueue) {
    comparacaoNfseQueue = new Queue<ComparacaoNfseJobPayload>(COMPARACAO_NFSE_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return comparacaoNfseQueue;
}

export function getGnreQueue(env: Env): Queue<GnreJobPayload> {
  if (!gnreQueue) {
    gnreQueue = new Queue<GnreJobPayload>(GNRE_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return gnreQueue;
}

export function getSciPortalNacionalQueue(env: Env): Queue<SciPortalNacionalJobPayload> {
  if (!sciPortalNacionalQueue) {
    sciPortalNacionalQueue = new Queue<SciPortalNacionalJobPayload>(SCI_PORTAL_NACIONAL_QUEUE_NAME, {
      connection: getRedis(env),
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 100 },
      },
    });
  }
  return sciPortalNacionalQueue;
}
