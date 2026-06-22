#!/usr/bin/env python3
"""CLI headless: Comparador de NFS-e (PDF via Gemini x XML).

Protocolo JSON lines no stdout (padrao das outras tools):
  {"kind": "progress", "value": 0..100}
  {"kind": "error", "message": "..."}
  {"kind": "done", "output": "<xlsx>", "result": {...}}
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from comparator import comparar
from excel import gerar_xlsx
from filename import build_xlsx_filename
from xml_parser import parse_nfse_directory


def emit(kind: str, **kw):
    print(json.dumps({"kind": kind, **kw}), flush=True)


def progress(value: int):
    emit("progress", value=max(0, min(100, value)))


def _build_result_payload(
    res,
    xml_ignorados,
    pdf_failed,
    pdf_lidos,
    xml_lidos,
    extract_stats=None,
    failure_kind=None,
    retry_after_sec=None,
    output_name=None,
):
    payload = {
        "soPdf": [e.to_dict() for e in res.so_pdf],
        "soXml": [e.to_dict() for e in res.so_xml],
        "matchedCount": res.matched_count,
        "xmlIgnorados": xml_ignorados,
        "pdfFalhos": pdf_failed,
        "duplicadosPdf": [g.to_dict() for g in res.duplicados_pdf],
        "totals": {
            "pdfEnviados": pdf_lidos + len(pdf_failed),
            "pdfLidos": pdf_lidos,
            "xmlEnviados": xml_lidos + len(xml_ignorados),
            "xmlLidos": xml_lidos,
            "matched": res.matched_count,
            "soPdf": len(res.so_pdf),
            "soXml": len(res.so_xml),
        },
    }
    if extract_stats is not None:
        payload["extractStats"] = extract_stats
    if failure_kind is not None:
        payload["failureKind"] = failure_kind
    if retry_after_sec is not None:
        payload["retryAfterSec"] = retry_after_sec
    if output_name is not None:
        payload["outputName"] = output_name
    return payload


def _build_governor():
    """Cria GeminiGovernor a partir de REDIS_URL ou retorna None se Redis indisponivel.

    Tres modos:
      - REDIS_URL definido + redis acessivel  -> governor real (compartilhado)
      - NFSE_FORCE_CIRCUIT_OPEN=1             -> fake redis com circuit pre-aberto (teste)
      - Sem nada                              -> None (modo single-process, sem governor)
    """
    if os.environ.get("NFSE_FORCE_CIRCUIT_OPEN") == "1":
        # Modo de teste: usa fakeredis com circuit ja aberto
        try:
            import fakeredis  # type: ignore
            from gemini_governor import build_default_governor

            r = fakeredis.FakeStrictRedis()
            gov = build_default_governor(r, rpm=1500, cooldown_sec=300)
            gov.circuit.record_failure()  # threshold default 3 — abrir manualmente
            gov.circuit._open(gov.circuit._now())
            return gov
        except Exception:
            return None

    redis_url = os.environ.get("REDIS_URL", "").strip()
    if not redis_url:
        return None
    try:
        import redis as _redis  # type: ignore
        from gemini_governor import build_default_governor

        rpm = int(os.environ.get("NFSE_GEMINI_RPM", "1500"))
        cooldown = int(os.environ.get("NFSE_CIRCUIT_COOLDOWN_SEC", "300"))
        client = _redis.Redis.from_url(redis_url)
        client.ping()
        return build_default_governor(client, rpm=rpm, cooldown_sec=cooldown)
    except Exception as e:
        print(
            json.dumps({"kind": "warn", "message": f"Governor desativado: {e}"}),
            flush=True,
        )
        return None


def processar(pdfs_dir: Path, xmls_dir: Path, output_xlsx: Path, output_json: Path) -> dict:
    progress(2)

    xml_entries, xml_ignorados = parse_nfse_directory(xmls_dir)
    progress(20)

    pdf_entries: list = []
    pdf_failed: list[dict] = []
    extract_stats: dict | None = None
    from pdf_extractor import SUPPORTED_EXTENSIONS, extract_from_directory

    pdfs_presentes = (
        [p for p in pdfs_dir.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS]
        if pdfs_dir.exists()
        else []
    )

    governor = _build_governor() if pdfs_presentes else None

    # Pre-check: circuit ja aberto -> fail-fast antes de gastar 1 token
    if governor is not None:
        from gemini_governor import CircuitState

        if governor.circuit.state() == CircuitState.OPEN:
            _, _, open_until = governor.circuit._read()
            import time as _time

            retry_after = max(0.0, open_until - _time.time())
            raise QuotaPreOpenError(retry_after_sec=retry_after)

    if pdfs_presentes:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip() or None

        def on_prog(i: int, n: int):
            base = 20
            span = 65
            progress(base + int((i / max(1, n)) * span))

        pdf_entries, pdf_failed, extract_stats = extract_from_directory(
            pdfs_dir,
            api_key=api_key,
            on_progress=on_prog,
            governor=governor,
        )
    else:
        progress(85)

    res = comparar(pdf_entries, xml_entries)
    progress(90)

    # Invariante de fechamento (rede de seguranca contra refactors).
    # Por construcao do comparador, ambos sao verdadeiros — emitimos warn
    # se algum dia deixar de ser, sem quebrar o job.
    if res.matched_count + len(res.so_pdf) != len(pdf_entries):
        emit(
            "warn",
            message=(
                f"Invariante PDF quebrada: matched={res.matched_count} + "
                f"soPdf={len(res.so_pdf)} != pdfLidos={len(pdf_entries)}"
            ),
        )
    if res.matched_count + len(res.so_xml) != len(xml_entries):
        emit(
            "warn",
            message=(
                f"Invariante XML quebrada: matched={res.matched_count} + "
                f"soXml={len(res.so_xml)} != xmlLidos={len(xml_entries)}"
            ),
        )

    # Detecta falha sistemica de quota: maioria dos pdfFalhos com motivo de quota
    failure_kind = None
    retry_after_sec = None
    if pdf_failed and len(pdf_failed) >= max(3, int(0.5 * len(pdfs_presentes))):
        quota_count = sum(
            1 for f in pdf_failed if "quota" in f.get("reason", "").lower() or "cota" in f.get("reason", "").lower()
        )
        if quota_count >= int(0.5 * len(pdf_failed)):
            failure_kind = "quota"
            if governor is not None:
                _, _, open_until = governor.circuit._read()
                import time as _time

                retry_after_sec = max(0.0, open_until - _time.time())

    # Nome amigavel do arquivo de saida: usa razao_social_tomador + timestamp.
    # O arquivo em disco continua em `output_xlsx`; `output_name` eh o nome
    # apresentado no Content-Disposition (download).
    all_entries = list(res.so_pdf) + list(res.so_xml) + list(pdf_entries) + list(xml_entries)
    output_name = build_xlsx_filename(all_entries)

    payload = _build_result_payload(
        res,
        xml_ignorados,
        pdf_failed,
        pdf_lidos=len(pdf_entries),
        xml_lidos=len(xml_entries),
        extract_stats=extract_stats,
        failure_kind=failure_kind,
        retry_after_sec=retry_after_sec,
        output_name=output_name,
    )
    output_json.parent.mkdir(parents=True, exist_ok=True)
    output_json.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    gerar_xlsx(output_xlsx, res.so_pdf, res.so_xml)
    progress(100)
    return payload


class QuotaPreOpenError(Exception):
    """Circuit ja estava aberto antes do job comecar — fail-fast sem processar."""

    def __init__(self, retry_after_sec: float):
        self.retry_after_sec = retry_after_sec
        super().__init__(f"Quota Gemini esgotada. Tente em ~{retry_after_sec:.0f}s.")


def main() -> int:
    p = argparse.ArgumentParser(description="Comparador NFS-e (PDF x XML)")
    p.add_argument("--pdfs-dir", required=True)
    p.add_argument("--xmls-dir", required=True)
    p.add_argument("--output-xlsx", required=True)
    p.add_argument("--output-json", required=True)
    args = p.parse_args()

    pdfs_dir = Path(args.pdfs_dir)
    xmls_dir = Path(args.xmls_dir)
    output_xlsx = Path(args.output_xlsx)
    output_json = Path(args.output_json)

    if not xmls_dir.exists():
        emit("error", message=f"Pasta de XMLs nao encontrada: {xmls_dir}")
        return 1

    try:
        result = processar(pdfs_dir, xmls_dir, output_xlsx, output_json)
        emit("done", output=str(output_xlsx), result=result)
        return 0
    except QuotaPreOpenError as e:
        emit("failed_quota", message=str(e), retryAfterSec=e.retry_after_sec)
        return 2
    except Exception as e:
        emit("error", message=str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
