"""Harness concorrente: simula 4 jobs paralelos compartilhando o mesmo bucket
(simulando o cenario de 10 usuarios em pico) e verifica que respeitamos o RPM
global mesmo com varios processos batendo no Gemini ao mesmo tempo.
"""
from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import fakeredis
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pdf_extractor
from gemini_governor import GeminiGovernor, TokenBucket, CircuitBreaker


def _write_fake_pdf(path: Path):
    path.write_bytes(b"%PDF-1.4\n% fake\n%%EOF\n")


@pytest.fixture
def fake_redis():
    """Fakeredis compartilhado entre threads."""
    return fakeredis.FakeStrictRedis()


def test_4_jobs_share_global_rate_limit(tmp_path, fake_redis, monkeypatch):
    """4 jobs paralelos com 10 PDFs cada compartilham bucket de 8 tokens.

    Sem refill, exatamente 8 chamadas devem ser bem-sucedidas; o resto cai em
    falha de quota (espera maior que max_wait_sec).
    """
    # Setup: 4 dirs com 10 PDFs cada
    job_dirs = []
    for j in range(4):
        d = tmp_path / f"job{j}"
        d.mkdir()
        for i in range(10):
            _write_fake_pdf(d / f"f{i}.pdf")
        job_dirs.append(d)

    # pdfplumber sempre retorna None -> tudo cai no Gemini
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    # Gemini mockado: pequena latencia + sucesso
    fake = '{"cnpj_tomador": "11222333000181", "numero_nf": "1", "chave_nf": null}'
    call_count = [0]
    lock = threading.Lock()

    def fake_call(*a, **kw):
        with lock:
            call_count[0] += 1
        time.sleep(0.01)
        return fake

    monkeypatch.setattr(pdf_extractor, "_call_gemini", fake_call)

    # Governor compartilhado: capacity=8, sem refill -> max 8 chamadas
    bucket = TokenBucket(
        fake_redis,
        key="g:bucket",
        capacity=8,
        refill_per_sec=0.0,
        sleeper=lambda s: None,
    )
    circuit = CircuitBreaker(fake_redis, key="g:circuit", failure_threshold=999)
    gov = GeminiGovernor(bucket=bucket, circuit=circuit, max_wait_sec=0.05)

    # Roda 4 jobs em paralelo
    results: list[tuple[int, int]] = []  # (entries_count, failed_count)
    threads = []

    def run(d: Path):
        entries, failed, _stats = pdf_extractor.extract_from_directory(
            d, api_key="fake", governor=gov
        )
        with lock:
            results.append((len(entries), len(failed)))

    for d in job_dirs:
        t = threading.Thread(target=run, args=(d,))
        threads.append(t)
        t.start()
    for t in threads:
        t.join(timeout=30)

    # Total de PDFs processados com sucesso == tokens iniciais (8)
    total_entries = sum(e for e, _ in results)
    total_failed = sum(f for _, f in results)
    assert total_entries == 8, f"esperado 8 sucessos, foi {total_entries}"
    assert total_failed == 32, f"esperado 32 falhas (40 - 8), foi {total_failed}"
    assert call_count[0] == 8, f"_call_gemini chamado {call_count[0]} vezes, esperado 8"


def test_concurrent_jobs_no_double_consume(tmp_path, fake_redis, monkeypatch):
    """100 chamadas concorrentes, capacity=10 -> exatamente 10 sucessos no Gemini."""
    for i in range(100):
        _write_fake_pdf(tmp_path / f"pdf_{i:03d}.pdf")

    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    fake = '{"cnpj_tomador": "11", "numero_nf": "1", "chave_nf": null}'
    call_count = [0]
    lock = threading.Lock()

    def fake_call(*a, **kw):
        with lock:
            call_count[0] += 1
        return fake

    monkeypatch.setattr(pdf_extractor, "_call_gemini", fake_call)
    # Forca alta concorrencia interna
    monkeypatch.setattr(pdf_extractor, "_ocr_concurrency", lambda: 16)

    bucket = TokenBucket(
        fake_redis, key="b", capacity=10, refill_per_sec=0.0, sleeper=lambda s: None
    )
    circuit = CircuitBreaker(fake_redis, key="c", failure_threshold=999)
    gov = GeminiGovernor(bucket=bucket, circuit=circuit, max_wait_sec=0.01)

    entries, failed, _stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="fake", governor=gov
    )
    assert len(entries) == 10
    assert len(failed) == 90
    assert call_count[0] == 10
