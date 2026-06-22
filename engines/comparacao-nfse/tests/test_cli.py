"""Smoke test do CLI: stdout JSON lines, geracao de result.json e xlsx."""
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

CLI = Path(__file__).resolve().parents[1] / "cli.py"
FIX = Path(__file__).parent / "fixtures"


def test_cli_apenas_xmls_sem_pdfs(tmp_path):
    """Sem PDFs: todas as entries ficam em so_xml. Nao chama Gemini."""
    xmls_dir = tmp_path / "xmls"
    pdfs_dir = tmp_path / "pdfs"
    xmls_dir.mkdir()
    pdfs_dir.mkdir()
    for f in ("nfse_abrasf.xml", "nfse_sem_chave.xml", "nfse_tomador_cpf.xml"):
        (xmls_dir / f).write_bytes((FIX / f).read_bytes())

    out_json = tmp_path / "result.json"
    out_xlsx = tmp_path / "out.xlsx"
    result = subprocess.run(
        [
            sys.executable,
            str(CLI),
            "--pdfs-dir",
            str(pdfs_dir),
            "--xmls-dir",
            str(xmls_dir),
            "--output-json",
            str(out_json),
            "--output-xlsx",
            str(out_xlsx),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    lines = [json.loads(l) for l in result.stdout.splitlines() if l.strip().startswith("{")]
    kinds = [l["kind"] for l in lines]
    assert "progress" in kinds
    assert kinds[-1] == "done"

    assert out_json.exists()
    data = json.loads(out_json.read_text(encoding="utf-8"))
    assert data["matchedCount"] == 0
    assert len(data["soXml"]) == 3
    assert len(data["soPdf"]) == 0
    assert out_xlsx.exists()

    # Totalizadores devem fechar com a entrada
    totals = data["totals"]
    assert totals["pdfEnviados"] == 0
    assert totals["pdfLidos"] == 0
    assert totals["xmlEnviados"] == 3
    assert totals["xmlLidos"] == 3
    assert totals["matched"] == 0
    assert totals["soPdf"] == 0
    assert totals["soXml"] == 3
    # Invariantes de fechamento
    assert totals["matched"] + totals["soPdf"] == totals["pdfLidos"]
    assert totals["matched"] + totals["soXml"] == totals["xmlLidos"]
    assert totals["pdfEnviados"] == totals["pdfLidos"] + len(data.get("pdfFalhos", []))
    assert totals["xmlEnviados"] == totals["xmlLidos"] + len(data.get("xmlIgnorados", []))
    # Sem duplicados nesse cenario
    assert data["duplicadosPdf"] == []


# ─── Failure modes (failureKind) ──────────────────────────────────────────────


def _write_fake_pdf(p: Path):
    p.write_bytes(b"%PDF-1.4\n% fake\n%%EOF\n")


def test_cli_emits_failed_quota_when_circuit_pre_opened(tmp_path):
    """Se o circuit ja esta aberto antes do job, CLI emite kind=failed_quota e sai."""
    redis = pytest.importorskip("fakeredis")  # nao bloqueia se falta

    xmls_dir = tmp_path / "xmls"
    pdfs_dir = tmp_path / "pdfs"
    xmls_dir.mkdir()
    pdfs_dir.mkdir()
    _write_fake_pdf(pdfs_dir / "scan.pdf")

    # CLI lê NFSE_FORCE_CIRCUIT_OPEN=1 para pre-abrir o circuit (modo de teste).
    # Sem Redis real, o CLI deve usar fake_redis embutido quando essa flag
    # estiver presente.
    env = os.environ.copy()
    env["NFSE_FORCE_CIRCUIT_OPEN"] = "1"
    env["GEMINI_API_KEY"] = "fake-key-for-test"

    out_json = tmp_path / "result.json"
    out_xlsx = tmp_path / "out.xlsx"
    proc = subprocess.run(
        [
            sys.executable,
            str(CLI),
            "--pdfs-dir",
            str(pdfs_dir),
            "--xmls-dir",
            str(xmls_dir),
            "--output-json",
            str(out_json),
            "--output-xlsx",
            str(out_xlsx),
        ],
        capture_output=True,
        text=True,
        env=env,
    )
    lines = [json.loads(l) for l in proc.stdout.splitlines() if l.strip().startswith("{")]
    kinds = [l.get("kind") for l in lines]
    # Deve emitir failed_quota e nao gerar XLSX
    assert "failed_quota" in kinds, f"kinds={kinds}"
    assert proc.returncode != 0
    failed_event = next(l for l in lines if l.get("kind") == "failed_quota")
    assert "retryAfterSec" in failed_event
    assert failed_event["retryAfterSec"] >= 0
