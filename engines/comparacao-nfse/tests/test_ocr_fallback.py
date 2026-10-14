"""Cadeia completa de fallback do OCR, do mais barato ao mais caro:

  1. OCR por codigo  — texto nativo (pdfplumber) e OCR local (rapidocr)
  2. Gemini gratuito — GEMINI_API_KEY (AI Studio), sob o governor
  3. Vertex pago     — API_KEY_VERTEX, so quando o 2 nao existe/bloqueou/falhou

O que importa garantir: o pago nunca e chamado se um nivel anterior resolveu,
e e chamado sempre que o anterior nao resolveu. Nenhuma chamada real de rede.
"""
import io
import json
import sys
import urllib.error
from pathlib import Path

import fakeredis
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ocr_local
import pdf_extractor
import pdf_text_extractor
from gemini_governor import CircuitBreaker, CircuitState, GeminiGovernor, TokenBucket
from xml_parser import NfseEntry

OK_JSON = '{"cnpj_tomador": "02184341000270", "numero_nf": "1493", "chave_nf": null}'


def _fake_pdf(p: Path):
    p.write_bytes(b"%PDF-1.4\n%fake\n")


def _entry(nome: str, metodo: str) -> NfseEntry:
    return NfseEntry(
        cnpj_tomador="02184341000270", numero_nf="1", chave_nf=None,
        source_file=nome, method=metodo,
    )


def _governor(threshold=3, cooldown=300):
    fr = fakeredis.FakeStrictRedis()
    return GeminiGovernor(
        bucket=TokenBucket(fr, key="t:bucket", capacity=100, refill_per_sec=10.0,
                           sleeper=lambda s: None),
        circuit=CircuitBreaker(fr, key="t:circuit", failure_threshold=threshold,
                               cooldown_sec=cooldown),
    )


class Chamadas:
    """Registra quem foi chamado, na ordem, e responde conforme o roteiro."""

    def __init__(self, monkeypatch, gemini=OK_JSON, vertex=OK_JSON):
        self.log: list[tuple[str, str]] = []
        self._respostas = {"gemini": gemini, "vertex": vertex}
        monkeypatch.setattr(pdf_extractor, "_call_gemini", self._fake("gemini"))
        monkeypatch.setattr(pdf_extractor, "_call_vertex", self._fake("vertex"))

    def _fake(self, nome):
        def call(path, *, api_key, model):
            self.log.append((nome, Path(path).name))
            r = self._respostas[nome]
            if isinstance(r, Exception):
                raise r
            return r
        return call

    def de(self, nome):
        return [f for n, f in self.log if n == nome]


@pytest.fixture
def so_nuvem(monkeypatch):
    """Nivel 1 nao resolve nada: forca tudo para o OCR na nuvem."""
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)
    monkeypatch.setattr(ocr_local, "available", lambda: False)


@pytest.fixture(autouse=True)
def sem_espera(monkeypatch):
    monkeypatch.setattr(pdf_extractor.time, "sleep", lambda s: None)


# ─── Nivel 1: OCR por codigo ──────────────────────────────────────────────────


def test_nivel1_texto_nativo_nao_chama_nenhuma_api(tmp_path, monkeypatch):
    _fake_pdf(tmp_path / "a.pdf")
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local",
                        lambda p: _entry("a.pdf", "local"))
    c = Chamadas(monkeypatch)

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago")

    assert len(entries) == 1 and failed == []
    assert c.log == []
    assert stats["local"] == 1 and stats["ocr_vertex"] == 0


def test_nivel1_ocr_local_nao_chama_nenhuma_api(tmp_path, monkeypatch):
    _fake_pdf(tmp_path / "scan.pdf")
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)
    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr",
                        lambda p: (_entry("scan.pdf", "ocr-local"), None))
    c = Chamadas(monkeypatch)

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago")

    assert len(entries) == 1 and failed == []
    assert c.log == []
    assert stats["ocr_local"] == 1


# ─── Nivel 2: Gemini gratuito ─────────────────────────────────────────────────


def test_nivel2_gratuita_resolve_e_vertex_nao_e_chamado(tmp_path, monkeypatch, so_nuvem):
    _fake_pdf(tmp_path / "a.pdf")
    c = Chamadas(monkeypatch)

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago", governor=_governor())

    assert len(entries) == 1 and failed == []
    assert c.de("gemini") == ["a.pdf"]
    assert c.de("vertex") == []
    assert stats["ocr"] == 1 and stats["ocr_vertex"] == 0


def test_sem_vertex_comportamento_antigo_inalterado(tmp_path, monkeypatch, so_nuvem):
    """Sem API_KEY_VERTEX, falha da gratuita vira falha listada — como antes."""
    _fake_pdf(tmp_path / "a.pdf")
    c = Chamadas(monkeypatch, gemini=Exception("429 RESOURCE_EXHAUSTED quota"))

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key=None)

    assert entries == []
    assert len(failed) == 1 and "Quota" in failed[0]["reason"]
    assert c.de("vertex") == []


# ─── Nivel 3: Vertex pago ─────────────────────────────────────────────────────


def test_nivel3_cota_gratuita_esgotada_cai_no_vertex(tmp_path, monkeypatch, so_nuvem):
    _fake_pdf(tmp_path / "a.pdf")
    c = Chamadas(monkeypatch, gemini=Exception("429 RESOURCE_EXHAUSTED quota exceeded"))
    gov = _governor(threshold=1)

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago", governor=gov)

    assert len(entries) == 1 and failed == []
    # Quota nao tem retry: 1 tentativa na gratuita, depois Vertex
    assert c.log == [("gemini", "a.pdf"), ("vertex", "a.pdf")]
    assert stats["ocr"] == 1 and stats["ocr_vertex"] == 1
    # A falha de cota da gratuita continua alimentando o circuito dela
    assert gov.circuit.state() == CircuitState.OPEN


def test_nivel3_circuito_aberto_vai_direto_pro_vertex(tmp_path, monkeypatch, so_nuvem):
    """Com a gratuita bloqueada, nem tenta ela: cada arquivo vai direto pro pago."""
    for i in range(3):
        _fake_pdf(tmp_path / f"s{i}.pdf")
    c = Chamadas(monkeypatch)
    gov = _governor(threshold=1)
    gov.circuit.record_failure()  # abre

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago", governor=gov)

    assert len(entries) == 3 and failed == []
    assert c.de("gemini") == []
    assert sorted(c.de("vertex")) == ["s0.pdf", "s1.pdf", "s2.pdf"]
    assert stats["ocr_vertex"] == 3


def test_nivel3_erro_generico_da_gratuita_tambem_cai_no_vertex(tmp_path, monkeypatch, so_nuvem):
    _fake_pdf(tmp_path / "a.pdf")
    c = Chamadas(monkeypatch, gemini=Exception("500 internal"))

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago")

    assert len(entries) == 1 and failed == []
    assert c.de("gemini") == ["a.pdf"] * 3  # erro generico: 1 + 2 retries
    assert c.de("vertex") == ["a.pdf"]
    assert stats["ocr_vertex"] == 1


def test_nivel3_so_vertex_configurado(tmp_path, monkeypatch, so_nuvem):
    _fake_pdf(tmp_path / "a.pdf")
    c = Chamadas(monkeypatch)

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key=None, vertex_key="pago")

    assert len(entries) == 1
    assert c.de("gemini") == [] and c.de("vertex") == ["a.pdf"]
    assert stats["ocr_disponivel"] is True and stats["ocr_vertex"] == 1


def test_imagem_cai_no_vertex_e_conta_como_imagem(tmp_path, monkeypatch, so_nuvem):
    (tmp_path / "nota.png").write_bytes(b"\x89PNG\r\n\x1a\n")
    Chamadas(monkeypatch, gemini=Exception("429 RESOURCE_EXHAUSTED"))

    entries, _failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago")

    assert len(entries) == 1
    assert stats["imagens"] == 1 and stats["ocr_vertex"] == 1


def test_todos_os_niveis_falham_lista_todos_os_motivos(tmp_path, monkeypatch):
    _fake_pdf(tmp_path / "ruim.pdf")
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)
    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr", lambda p: (None, "OCR local ilegivel"))
    Chamadas(
        monkeypatch,
        gemini=Exception("429 RESOURCE_EXHAUSTED"),
        vertex=Exception("Vertex HTTP 403 PERMISSION_DENIED: billing"),
    )

    entries, failed, _stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago")

    assert entries == []
    motivo = failed[0]["reason"]
    assert "OCR local ilegivel" in motivo
    assert "Quota" in motivo
    assert "Vertex: Chave Gemini invalida" in motivo


def test_cadeia_completa_cada_arquivo_para_no_nivel_certo(tmp_path, monkeypatch):
    """4 arquivos, cada um resolvido num nivel diferente da cadeia."""
    for n in ("texto.pdf", "scan.pdf", "gratis.pdf", "pago.pdf"):
        _fake_pdf(tmp_path / n)
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local",
                        lambda p: _entry(p.name, "local") if p.name == "texto.pdf" else None)
    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr",
                        lambda p: (_entry(p.name, "ocr-local"), None) if p.name == "scan.pdf"
                        else (None, "ilegivel"))
    log = []

    def gemini(path, *, api_key, model):
        log.append(("gemini", Path(path).name))
        if Path(path).name == "pago.pdf":
            raise Exception("429 RESOURCE_EXHAUSTED")
        return OK_JSON

    def vertex(path, *, api_key, model):
        log.append(("vertex", Path(path).name))
        return OK_JSON

    monkeypatch.setattr(pdf_extractor, "_call_gemini", gemini)
    monkeypatch.setattr(pdf_extractor, "_call_vertex", vertex)

    entries, failed, stats = pdf_extractor.extract_from_directory(
        tmp_path, api_key="gratis", vertex_key="pago")

    assert len(entries) == 4 and failed == []
    assert sorted(log) == [("gemini", "gratis.pdf"), ("gemini", "pago.pdf"),
                           ("vertex", "pago.pdf")]
    assert (stats["local"], stats["ocr_local"], stats["ocr"], stats["ocr_vertex"]) == (1, 1, 2, 1)


# ─── _call_vertex (HTTP mockado) ──────────────────────────────────────────────


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_call_vertex_monta_request_e_le_resposta(tmp_path, monkeypatch):
    pdf = tmp_path / "a.pdf"
    _fake_pdf(pdf)
    vistos = {}

    def fake_urlopen(req, timeout):
        vistos["url"] = req.full_url
        vistos["key"] = req.get_header("X-goog-api-key")
        vistos["body"] = json.loads(req.data)
        return _Resp(json.dumps(
            {"candidates": [{"content": {"parts": [{"text": OK_JSON}]}}]}).encode())

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    out = pdf_extractor._call_vertex(pdf, api_key="segredo", model="gemini-2.5-flash")

    assert out == OK_JSON
    assert vistos["url"].endswith("/models/gemini-2.5-flash:generateContent")
    assert "segredo" not in vistos["url"]  # chave vai no header, nunca na URL/log
    assert vistos["key"] == "segredo"
    partes = vistos["body"]["contents"][0]["parts"]
    assert partes[0]["text"] == pdf_extractor.PROMPT
    assert partes[1]["inlineData"]["mimeType"] == "application/pdf"


def test_call_vertex_429_vira_erro_de_quota(tmp_path, monkeypatch):
    pdf = tmp_path / "a.pdf"
    _fake_pdf(pdf)
    corpo = json.dumps({"error": {"code": 429, "status": "RESOURCE_EXHAUSTED",
                                  "message": "Quota exceeded"}}).encode()

    def fake_urlopen(req, timeout):
        raise urllib.error.HTTPError(req.full_url, 429, "Too Many", {}, io.BytesIO(corpo))

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)

    with pytest.raises(RuntimeError) as ei:
        pdf_extractor._call_vertex(pdf, api_key="k", model="m")
    assert "RESOURCE_EXHAUSTED" in str(ei.value)
    assert pdf_extractor._is_non_retryable(ei.value)
    assert pdf_extractor._summarize_error(ei.value).startswith("Quota")


def test_call_vertex_recusa_arquivo_acima_de_20mb(tmp_path, monkeypatch):
    pdf = tmp_path / "grande.pdf"
    _fake_pdf(pdf)
    monkeypatch.setattr(pdf_extractor, "_INLINE_LIMIT_BYTES", 4)
    monkeypatch.setattr("urllib.request.urlopen",
                        lambda *a, **k: pytest.fail("nao deveria chamar a rede"))

    with pytest.raises(ValueError, match="limite inline"):
        pdf_extractor._call_vertex(pdf, api_key="k", model="m")


# ─── CLI: circuito aberto nao derruba o job quando ha Vertex ──────────────────


def _rodar_cli(tmp_path, monkeypatch, *, vertex: bool):
    import cli

    pdfs, xmls = tmp_path / "pdfs", tmp_path / "xmls"
    pdfs.mkdir()
    xmls.mkdir()
    _fake_pdf(pdfs / "scan.pdf")
    monkeypatch.setenv("NFSE_FORCE_CIRCUIT_OPEN", "1")
    monkeypatch.setenv("GEMINI_API_KEY", "gratis")
    if vertex:
        monkeypatch.setenv("API_KEY_VERTEX", "pago")
    else:
        monkeypatch.delenv("API_KEY_VERTEX", raising=False)
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)
    monkeypatch.setattr(ocr_local, "available", lambda: False)
    c = Chamadas(monkeypatch)
    res = cli.processar(pdfs, xmls, tmp_path / "out.xlsx", tmp_path / "result.json")
    return res, c


def test_cli_circuito_aberto_com_vertex_segue_pelo_vertex(tmp_path, monkeypatch):
    res, c = _rodar_cli(tmp_path, monkeypatch, vertex=True)
    assert c.de("gemini") == [] and c.de("vertex") == ["scan.pdf"]
    stats = json.loads((tmp_path / "result.json").read_text(encoding="utf-8"))["extractStats"]
    assert stats["ocr_vertex"] == 1


def test_cli_circuito_aberto_sem_vertex_continua_fail_fast(tmp_path, monkeypatch):
    import cli

    with pytest.raises(cli.QuotaPreOpenError):
        _rodar_cli(tmp_path, monkeypatch, vertex=False)
