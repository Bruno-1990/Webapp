import type { ComparacaoNfseResult, NfseFailureKind } from "@webapp/contracts";

export type StdoutEvent =
  | { kind: "progress"; value: number }
  | { kind: "error"; message: string }
  | { kind: "warn"; message: string }
  | { kind: "failed_quota"; message: string; retryAfterSec: number }
  | { kind: "done"; result?: ComparacaoNfseResult; output?: string };

/**
 * Parse uma unica linha JSON do stdout do CLI Python. Retorna null se a linha
 * nao for JSON valido ou nao tiver o campo `kind` esperado.
 */
export function parseStdoutLine(line: string): StdoutEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const o = JSON.parse(trimmed) as Partial<StdoutEvent> & { kind?: string };
    if (o.kind === "progress" && typeof (o as { value?: unknown }).value === "number") {
      return { kind: "progress", value: (o as { value: number }).value };
    }
    if (o.kind === "error" && typeof o.message === "string") {
      return { kind: "error", message: o.message };
    }
    if (o.kind === "warn" && typeof o.message === "string") {
      return { kind: "warn", message: o.message };
    }
    if (
      o.kind === "failed_quota" &&
      typeof o.message === "string" &&
      typeof (o as { retryAfterSec?: unknown }).retryAfterSec === "number"
    ) {
      return {
        kind: "failed_quota",
        message: o.message,
        retryAfterSec: (o as { retryAfterSec: number }).retryAfterSec,
      };
    }
    if (o.kind === "done") {
      return { kind: "done", result: (o as { result?: ComparacaoNfseResult }).result };
    }
  } catch {
    /* linha invalida */
  }
  return null;
}

export type CollectedRunState = {
  doneResult: ComparacaoNfseResult | null;
  failureKind: NfseFailureKind | null;
  retryAfterSec: number | null;
  jsonError: string | null;
};

export function emptyRunState(): CollectedRunState {
  return { doneResult: null, failureKind: null, retryAfterSec: null, jsonError: null };
}

/**
 * Aplica um StdoutEvent ao estado acumulado da execucao. Retorna o estado
 * atualizado (mesmo objeto, mutado) e indica se houve mudanca de progresso
 * via callback.
 */
export function applyEvent(
  state: CollectedRunState,
  event: StdoutEvent,
  onProgress: (value: number) => void,
): void {
  switch (event.kind) {
    case "progress":
      onProgress(event.value);
      break;
    case "error":
      state.jsonError = event.message;
      break;
    case "failed_quota":
      state.failureKind = "quota";
      state.retryAfterSec = event.retryAfterSec;
      state.jsonError = event.message;
      break;
    case "done":
      state.doneResult = event.result ?? null;
      break;
    case "warn":
      // ignorado intencionalmente — vira log do worker mas nao falha o job
      break;
  }
}
