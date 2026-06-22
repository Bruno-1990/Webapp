"""Extracao via Gemini: testa parsing de resposta mockada, sem chamada real."""
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import fakeredis
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pdf_extractor
from gemini_governor import (
    CircuitBreaker,
    CircuitState,
    GeminiGovernor,
    QuotaExhaustedError,
    TokenBucket,
)


def _write_fake_pdf(path: Path):
    path.write_bytes(b"%PDF-1.4\n% fake\n%%EOF\n")


def _write_fake_image(path: Path):
    path.write_bytes(b"\x89PNG\r\n\x1a\n" if path.suffix == ".png" else b"\xff\xd8\xff\xe0fake")


def test_parsing_resposta_json_valida(tmp_path):
    pdf = tmp_path / "a.pdf"
    _write_fake_pdf(pdf)

    fake_response = MagicMock()
    fake_response.text = (
        '{"cnpj_tomador": "12345678000199", "numero_nf": "42", '
        '"chave_nf": "35260312345678000199551000000042000000001"}'
    )
    with patch.object(pdf_extractor, "_call_gemini", return_value=fake_response.text):
        entry = pdf_extractor.extract_from_pdf(pdf, api_key="fake-key")

    assert entry is not None
    assert entry.cnpj_tomador == "12345678000199"
    assert entry.numero_nf == "42"
    assert entry.chave_nf == "35260312345678000199551000000042000000001"
    assert entry.source_file == "a.pdf"


def test_campo_ausente_vira_none(tmp_path):
    pdf = tmp_path / "b.pdf"
    _write_fake_pdf(pdf)

    fake = '{"cnpj_tomador": "12345678000199", "numero_nf": "99"}'
    with patch.object(pdf_extractor, "_call_gemini", return_value=fake):
        entry = pdf_extractor.extract_from_pdf(pdf, api_key="fake-key")

    assert entry is not None
    assert entry.chave_nf is None


def test_resposta_com_markdown_fences(tmp_path):
    """Gemini as vezes retorna ```json ... ```; o parser deve tolerar."""
    pdf = tmp_path / "c.pdf"
    _write_fake_pdf(pdf)

    fake = (
        '```json\n{"cnpj_tomador": "11.222.333/0001-81", '
        '"numero_nf": "42", "chave_nf": null}\n```'
    )
    with patch.object(pdf_extractor, "_call_gemini", return_value=fake):
        entry = pdf_extractor.extract_from_pdf(pdf, api_key="fake-key")

    assert entry is not None
    assert entry.cnpj_tomador == "11222333000181"
    assert entry.numero_nf == "42"
    assert entry.chave_nf is None


def test_resposta_invalida_retorna_none(tmp_path):
    pdf = tmp_path / "d.pdf"
    _write_fake_pdf(pdf)

    with patch.object(pdf_extractor, "_call_gemini", return_value="nao eh json"):
        entry = pdf_extractor.extract_from_pdf(pdf, api_key="fake-key")

    assert entry is None


def test_batch_processamento(tmp_path, monkeypatch):
    pdfs = []
    for i in range(3):
        p = tmp_path / f"f{i}.pdf"
        _write_fake_pdf(p)
        pdfs.append(p)

    respostas = [
        '{"cnpj_tomador": "A", "numero_nf": "1", "chave_nf": null}',
        '{"cnpj_tomador": "B", "numero_nf": "2", "chave_nf": null}',
        '{"cnpj_tomador": "C", "numero_nf": "3", "chave_nf": null}',
    ]
    it = iter(respostas)
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: next(it))
    # Forca todos a cair no Gemini (PDFs falsos nao tem texto extraivel).
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    progresso = []
    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path,
        api_key="fake",
        on_progress=lambda i, n: progresso.append((i, n)),
    )
    assert len(entries) == 3
    assert failed == []
    assert progresso[-1] == (3, 3)
    assert stats == {"local": 0, "ocr": 3, "imagens": 0, "ocr_disponivel": True}


def test_mime_type_para_pdf_e_imagens():
    assert pdf_extractor._mime_type_for(Path("x.pdf")) == "application/pdf"
    assert pdf_extractor._mime_type_for(Path("y.png")) == "image/png"
    assert pdf_extractor._mime_type_for(Path("a.jpg")) == "image/jpeg"
    assert pdf_extractor._mime_type_for(Path("a.JPEG")) == "image/jpeg"
    assert pdf_extractor._mime_type_for(Path("z.tiff")) is None


def test_extract_de_imagem_png(tmp_path):
    img = tmp_path / "nota.png"
    _write_fake_image(img)

    fake = '{"cnpj_tomador": "22334455000199", "numero_nf": "7", "chave_nf": null}'
    with patch.object(pdf_extractor, "_call_gemini", return_value=fake):
        entry = pdf_extractor.extract_from_pdf(img, api_key="fake-key")

    assert entry is not None
    assert entry.cnpj_tomador == "22334455000199"
    assert entry.source_file == "nota.png"


def test_directory_processa_pdf_e_imagens_juntos(tmp_path, monkeypatch):
    _write_fake_pdf(tmp_path / "a.pdf")
    _write_fake_image(tmp_path / "b.jpg")
    _write_fake_image(tmp_path / "c.png")

    respostas = [
        '{"cnpj_tomador": "A", "numero_nf": "1", "chave_nf": null}',
        '{"cnpj_tomador": "B", "numero_nf": "2", "chave_nf": null}',
        '{"cnpj_tomador": "C", "numero_nf": "3", "chave_nf": null}',
    ]
    it = iter(respostas)
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: next(it))
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    entries, failed, _stats = pdf_extractor.extract_from_directory(tmp_path, api_key="fake")
    assert len(entries) == 3
    assert failed == []
    assert {e.source_file for e in entries} == {"a.pdf", "b.jpg", "c.png"}


def test_local_extraido_nao_chama_gemini(tmp_path, monkeypatch):
    """PDF que extrai bem localmente nao deve gastar chamada Gemini."""
    _write_fake_pdf(tmp_path / "ok.pdf")

    from xml_parser import NfseEntry
    import pdf_text_extractor

    fake_local = NfseEntry(
        cnpj_tomador="11222333000181", numero_nf="42", chave_nf=None, source_file="ok.pdf"
    )
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: fake_local)

    chamadas = []
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: chamadas.append(1) or "")

    entries, failed, stats = pdf_extractor.extract_from_directory(tmp_path, api_key="fake")
    assert len(entries) == 1
    assert entries[0].numero_nf == "42"
    assert chamadas == []  # nao chamou Gemini
    assert stats["local"] == 1
    assert stats["ocr"] == 0


def test_sem_api_key_pdf_scan_vai_pra_failed(tmp_path, monkeypatch):
    """Sem GEMINI_API_KEY, PDFs sem texto extraivel devem ir pra falhas com motivo claro."""
    _write_fake_pdf(tmp_path / "scan.pdf")
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    entries, failed, stats = pdf_extractor.extract_from_directory(tmp_path, api_key=None)
    assert entries == []
    assert len(failed) == 1
    assert failed[0]["file"] == "scan.pdf"
    assert "GEMINI_API_KEY" in failed[0]["reason"]
    assert stats == {"local": 0, "ocr": 0, "imagens": 0, "ocr_disponivel": False}


# ─── Integracao com governor (rate limit + circuit breaker) ──────────────────


def _make_governor(fake_redis, *, capacity=100, rpm_per_sec=10.0, threshold=2, cooldown=60):
    """Helper: governor pronto pra teste com clock controlavel."""
    return GeminiGovernor(
        bucket=TokenBucket(
            fake_redis,
            key="test:bucket",
            capacity=capacity,
            refill_per_sec=rpm_per_sec,
            sleeper=lambda s: None,  # nao bloqueia
        ),
        circuit=CircuitBreaker(
            fake_redis, key="test:circuit", failure_threshold=threshold, cooldown_sec=cooldown
        ),
    )


def test_governor_consumes_token_per_call(tmp_path, monkeypatch):
    """Cada chamada bem-sucedida consome 1 token do bucket."""
    pdf = tmp_path / "a.pdf"
    _write_fake_pdf(pdf)
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    fake = '{"cnpj_tomador": "11222333000181", "numero_nf": "1", "chave_nf": null}'
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: fake)

    fr = fakeredis.FakeStrictRedis()
    gov = _make_governor(fr, capacity=5, rpm_per_sec=0.0)

    entries, failed, _stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="fake", governor=gov
    )
    assert len(entries) == 1
    # Bucket comeca com 5 tokens; uma chamada -> 4 restantes
    ok, _ = gov.bucket.try_take(4)
    assert ok is True


def test_governor_quota_error_records_failure_and_opens_circuit(tmp_path, monkeypatch):
    """Quando Gemini retorna 429/quota, circuit registra falha. Threshold=2 -> abre na 2a."""
    for i in range(2):
        _write_fake_pdf(tmp_path / f"scan_{i}.pdf")
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    def raise_quota(*a, **kw):
        raise Exception("429 RESOURCE_EXHAUSTED quota exceeded")

    monkeypatch.setattr(pdf_extractor, "_call_gemini", raise_quota)

    fr = fakeredis.FakeStrictRedis()
    gov = _make_governor(fr, threshold=2, cooldown=60)

    pdf_extractor.extract_from_directory(tmp_path, api_key="fake", governor=gov)
    # Apos 2 falhas seguidas -> circuit OPEN
    assert gov.circuit.state() == CircuitState.OPEN


def test_governor_circuit_open_blocks_calls_without_calling_gemini(tmp_path, monkeypatch):
    """Se circuit ja esta aberto, nao chama Gemini — todas as falhas tem reason de quota."""
    for i in range(3):
        _write_fake_pdf(tmp_path / f"scan_{i}.pdf")
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    chamadas = []
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: chamadas.append(1) or "")

    fr = fakeredis.FakeStrictRedis()
    gov = _make_governor(fr, threshold=1, cooldown=300)
    # Pre-abre o circuit
    gov.circuit.record_failure()

    entries, failed, _stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="fake", governor=gov
    )
    assert entries == []
    assert len(failed) == 3
    assert all("Cota" in f["reason"] or "quota" in f["reason"].lower() for f in failed)
    assert chamadas == []  # nenhuma chamada Gemini


def test_governor_success_records_success_resets_failures(tmp_path, monkeypatch):
    """Sucesso reseta o contador de falhas (para nao acumular ate threshold com erros isolados)."""
    _write_fake_pdf(tmp_path / "ok.pdf")
    import pdf_text_extractor
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)

    fake = '{"cnpj_tomador": "11222333000181", "numero_nf": "1", "chave_nf": null}'
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: fake)

    fr = fakeredis.FakeStrictRedis()
    gov = _make_governor(fr, threshold=3, cooldown=60)
    # Simula 1 falha previa
    gov.circuit.record_failure()

    pdf_extractor.extract_from_directory(tmp_path, api_key="fake", governor=gov)
    # Sucesso -> circuit deveria estar CLOSED com failures=0
    state, failures, _ = gov.circuit._read()
    assert state == CircuitState.CLOSED
    assert failures == 0
