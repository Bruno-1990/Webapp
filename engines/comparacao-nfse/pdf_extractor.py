"""Extrai CNPJ tomador, numero e chave de cada PDF via Gemini API.

O import de google.generativeai eh lazy para que os testes (que mockam
_call_gemini) rodem sem a dependencia instalada.
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Callable

from xml_parser import NfseEntry, display_name

# Modelo padrao. `gemini-flash-latest` segue a versao mais recente; pode-se
# pinar via env var GEMINI_MODEL (ex.: gemini-2.5-flash, gemini-2.5-pro).
DEFAULT_MODEL = os.environ.get("GEMINI_MODEL", "gemini-flash-latest").strip() or "gemini-flash-latest"

PROMPT = (
    "Voce le uma Nota Fiscal de Servico brasileira (NFS-e). "
    "Extraia APENAS o que esta impresso. Retorne somente JSON, "
    "sem texto antes ou depois, no formato exato: "
    '{"cnpj_tomador": "<string ou null>", '
    '"razao_social_tomador": "<string ou null>", '
    '"numero_nf": "<string ou null>", '
    '"chave_nf": "<string ou null>", '
    '"cnpj_prestador": "<string ou null>", '
    '"razao_social_prestador": "<string ou null>"}\n'
    "- cnpj_tomador: CNPJ do TOMADOR DE SERVICO (14 digitos). "
    "Se for CPF, retorne null.\n"
    "- razao_social_tomador: Razao Social do TOMADOR (quem contratou o servico).\n"
    "- numero_nf: numero da nota fiscal.\n"
    "- chave_nf: chave de acesso/verificacao (use null se ausente).\n"
    "- cnpj_prestador: CNPJ do PRESTADOR DE SERVICO (14 digitos, quem emitiu a nota).\n"
    "- razao_social_prestador: Razao Social do PRESTADOR (nome da empresa que emitiu)."
)

_FENCE_RE = re.compile(r"```(?:json)?\s*(.+?)\s*```", re.DOTALL)
_JSON_OBJ_RE = re.compile(r"\{.*\}", re.DOTALL)

SUPPORTED_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png")

_MIME_BY_EXT = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


def _mime_type_for(path: Path) -> str | None:
    return _MIME_BY_EXT.get(path.suffix.lower())


def _strip_fences(s: str) -> str:
    m = _FENCE_RE.search(s)
    return m.group(1).strip() if m else s.strip()


def _extract_json_object(raw: str) -> dict | None:
    s = _strip_fences(raw)
    try:
        return json.loads(s)
    except json.JSONDecodeError:
        pass
    m = _JSON_OBJ_RE.search(s)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


# Gemini aceita ate 20 MB de inline data por request. NFS-e tipica e <2 MB.
# Acima disso, fallback para upload_file (que aceita ate ~2 GB).
_INLINE_LIMIT_BYTES = 20 * 1024 * 1024


def _call_gemini(pdf_path: Path, api_key: str, model: str) -> str:
    """Chamada real ao Gemini. Isolada para permitir mock nos testes.

    Estrategia: bytes inline (rapido — uma round-trip). Se o arquivo passar
    de 20 MB, cai pro upload_file (mais lento mas suporta arquivos grandes).
    """
    import google.generativeai as genai

    mime = _mime_type_for(pdf_path) or "application/pdf"
    genai.configure(api_key=api_key)
    gm = genai.GenerativeModel(model)

    size = pdf_path.stat().st_size
    if size <= _INLINE_LIMIT_BYTES:
        data = pdf_path.read_bytes()
        resp = gm.generate_content([PROMPT, {"mime_type": mime, "data": data}])
        return resp.text or ""

    # Fallback: upload + delete para arquivos grandes
    uploaded = genai.upload_file(path=str(pdf_path), mime_type=mime)
    try:
        resp = gm.generate_content([PROMPT, uploaded])
        return resp.text or ""
    finally:
        try:
            genai.delete_file(uploaded.name)
        except Exception:
            pass


def _normalize(value) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s or s.lower() in {"null", "none", "n/a", "na"}:
        return None
    return s


_NON_RETRYABLE = (
    "quota",
    "resource_exhausted",
    "resource exhausted",
    "permission_denied",
    "unauthenticated",
    "invalid api key",
)


def _summarize_error(exc: Exception) -> str:
    """Converte exception do Gemini em mensagem curta amigavel."""
    msg = str(exc)
    low = msg.lower()
    if "quota" in low or "resource_exhausted" in low or "resource exhausted" in low:
        return "Quota do Gemini excedida (sem creditos/billing). Veja https://ai.dev/rate-limit."
    if "permission_denied" in low or "unauthenticated" in low or "invalid api key" in low:
        return "Chave Gemini invalida ou sem permissao (PERMISSION_DENIED/UNAUTHENTICATED)."
    if "deadline_exceeded" in low or "timeout" in low:
        return "Timeout na chamada ao Gemini."
    # Primeira linha, sem stacktrace
    return msg.splitlines()[0][:200]


def _is_non_retryable(exc: Exception) -> bool:
    low = str(exc).lower()
    return any(k in low for k in _NON_RETRYABLE)


def _extract_with_reason(
    pdf_path: str | Path,
    api_key: str,
    *,
    model: str = DEFAULT_MODEL,
    max_retries: int = 2,
    governor=None,
) -> tuple[NfseEntry | None, str | None]:
    """Retorna (entry, None) em sucesso ou (None, motivo) em falha.

    Se `governor` for passado, respeita rate limit e circuit breaker.
    """
    from gemini_governor import QuotaExhaustedError  # lazy: governor opcional

    p = Path(pdf_path)
    raw: str | None = None
    last_reason: str | None = None

    # Pre-check: circuit aberto faz fail-fast sem chamar Gemini
    if governor is not None:
        try:
            governor.guard()
        except QuotaExhaustedError as e:
            return None, str(e)

    for attempt in range(max_retries + 1):
        try:
            raw = _call_gemini(p, api_key=api_key, model=model)
            if governor is not None:
                governor.report_success()
            break
        except Exception as e:
            last_reason = _summarize_error(e)
            if governor is not None and "quota" in str(e).lower() or "resource_exhausted" in str(e).lower():
                governor.report_failure()
            if _is_non_retryable(e) or attempt >= max_retries:
                raw = None
                break
            time.sleep(1.5 * (attempt + 1))

    if raw is None:
        return None, last_reason or "Falha desconhecida ao chamar o Gemini"

    obj = _extract_json_object(raw)
    if not isinstance(obj, dict):
        return None, "Gemini retornou texto nao-JSON ou vazio"

    cnpj = _normalize(obj.get("cnpj_tomador"))
    if cnpj:
        cnpj = re.sub(r"\D", "", cnpj) or None
    numero = _normalize(obj.get("numero_nf"))
    chave = _normalize(obj.get("chave_nf"))

    cnpj_pres = _normalize(obj.get("cnpj_prestador"))
    if cnpj_pres:
        cnpj_pres = re.sub(r"\D", "", cnpj_pres) or None
        if cnpj_pres and len(cnpj_pres) != 14:
            cnpj_pres = None  # CPF ou string invalida
    razao = _normalize(obj.get("razao_social_prestador"))
    razao_tomador = _normalize(obj.get("razao_social_tomador"))

    return NfseEntry(
        cnpj_tomador=cnpj,
        numero_nf=numero,
        chave_nf=chave,
        source_file=display_name(p.name),
        method="ocr",
        cnpj_prestador=cnpj_pres,
        razao_social_prestador=razao,
        razao_social_tomador=razao_tomador,
    ), None


def extract_from_pdf(
    pdf_path: str | Path,
    api_key: str,
    *,
    model: str = DEFAULT_MODEL,
    max_retries: int = 2,
    governor=None,
) -> NfseEntry | None:
    entry, _ = _extract_with_reason(
        pdf_path,
        api_key=api_key,
        model=model,
        max_retries=max_retries,
        governor=governor,
    )
    return entry


def _list_supported(directory: Path) -> list[Path]:
    if not directory.exists():
        return []
    found: list[Path] = []
    for f in directory.rglob("*"):
        if f.is_file() and f.suffix.lower() in SUPPORTED_EXTENSIONS:
            found.append(f)
    return sorted(found)


def _ocr_concurrency() -> int:
    """Numero de chamadas Gemini em paralelo. Default 8 (I/O bound, paid tier
    aguenta milhares de RPM). Override via env NFSE_OCR_CONCURRENCY.
    """
    raw = os.environ.get("NFSE_OCR_CONCURRENCY", "").strip()
    try:
        n = int(raw) if raw else 8
    except ValueError:
        n = 8
    return max(1, min(n, 32))


def _local_concurrency() -> int:
    """Threads para pdfplumber em pass 1. Default 8: pdfplumber libera GIL em
    I/O e o ganho satura cedo (CPU-bound parsing limita). Override via env
    NFSE_LOCAL_CONCURRENCY.
    """
    raw = os.environ.get("NFSE_LOCAL_CONCURRENCY", "").strip()
    try:
        n = int(raw) if raw else 8
    except ValueError:
        n = 8
    return max(1, min(n, 32))


def extract_from_directory(
    directory: str | Path,
    api_key: str | None = None,
    *,
    model: str = DEFAULT_MODEL,
    on_progress: Callable[[int, int], None] | None = None,
    governor=None,
) -> tuple[list[NfseEntry], list[dict], dict]:
    """Extrai entries de PDFs/imagens em `directory`.

    Pass 1 (sequencial, rapido): pdfplumber em todos os PDFs.
    Pass 2 (paralelo, lento): OCR Gemini nos que ficaram + imagens.

    Retorna `(entries, failed, stats)`:
      stats = {"local": int, "ocr": int, "imagens": int, "ocr_disponivel": bool}
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from pdf_text_extractor import extract_from_pdf_local

    base = Path(directory)
    files = _list_supported(base)
    total = len(files)
    failed: list[dict] = []
    stats = {"local": 0, "ocr": 0, "imagens": 0, "ocr_disponivel": bool(api_key)}

    # Mapeia indice -> entry (preserva ordem original ao final)
    entries_by_idx: dict[int, NfseEntry] = {}
    needs_ocr: list[tuple[int, Path]] = []
    local_done = 0

    # ── Pass 1: extracao local em paralelo (pdfplumber) ──────────────────
    pdf_items = [(i, f) for i, f in enumerate(files) if f.suffix.lower() == ".pdf"]
    non_pdf_items = [(i, f) for i, f in enumerate(files) if f.suffix.lower() != ".pdf"]

    if pdf_items:
        workers = min(_local_concurrency(), len(pdf_items))
        with ThreadPoolExecutor(max_workers=workers) as ex:
            future_to_item = {
                ex.submit(extract_from_pdf_local, f): (i, f) for i, f in pdf_items
            }
            for fut in as_completed(future_to_item):
                i, f = future_to_item[fut]
                try:
                    entry = fut.result()
                except Exception:
                    entry = None
                if entry is not None:
                    entries_by_idx[i] = entry
                    stats["local"] += 1
                    local_done += 1
                    if on_progress:
                        on_progress(local_done, total)
                else:
                    # PDF falhou pass 1 -> vai pra pass 2 (OCR). NAO incrementa
                    # local_done para nao contar duas vezes no progresso total.
                    needs_ocr.append((i, f))

    # Imagens vao direto pro OCR (nunca passam por pdfplumber)
    needs_ocr.extend(non_pdf_items)
    needs_ocr.sort(key=lambda t: t[0])

    # ── Pass 2: OCR Gemini (paralelo) ────────────────────────────────────
    if needs_ocr:
        if not api_key:
            for _, f in needs_ocr:
                ext = f.suffix.lower()
                failed.append({
                    "file": display_name(f.name),
                    "reason": (
                        "PDF sem texto extraivel (provavel scan) e GEMINI_API_KEY "
                        "ausente — defina a chave para habilitar OCR."
                    )
                    if ext == ".pdf"
                    else "Imagem requer OCR mas GEMINI_API_KEY nao foi definida.",
                })
        else:
            workers = min(_ocr_concurrency(), len(needs_ocr))
            ocr_done = 0
            with ThreadPoolExecutor(max_workers=workers) as ex:
                future_to_item = {
                    ex.submit(
                        _extract_with_reason,
                        f,
                        api_key=api_key,
                        model=model,
                        governor=governor,
                    ): (i, f)
                    for i, f in needs_ocr
                }
                for fut in as_completed(future_to_item):
                    i, f = future_to_item[fut]
                    try:
                        ocr_entry, reason = fut.result()
                    except Exception as exc:
                        ocr_entry, reason = None, _summarize_error(exc)
                    ext = f.suffix.lower()
                    if ocr_entry is not None:
                        entries_by_idx[i] = ocr_entry
                        if ext == ".pdf":
                            stats["ocr"] += 1
                        else:
                            stats["imagens"] += 1
                    else:
                        failed.append({
                            "file": display_name(f.name),
                            "reason": reason or "desconhecido",
                        })
                    ocr_done += 1
                    if on_progress:
                        on_progress(local_done + ocr_done, total)

    # Ordena por indice original para estabilidade de saida
    entries = [entries_by_idx[i] for i in sorted(entries_by_idx.keys())]
    return entries, failed, stats
