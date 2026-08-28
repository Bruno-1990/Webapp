"""Orquestracao dos tres passes de extracao e o relato de nao lidos.

Ordem esperada, do mais barato ao mais caro:
  1. pdfplumber (texto nativo)  2. OCR local  3. OCR Gemini (fallback)

A garantia mais importante aqui nao e de performance: e que NENHUM arquivo
some. Todo arquivo entregue tem de sair como entry ou como falha listada com
motivo — caso contrario o usuario recebe um comparativo incompleto sem saber.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ocr_local
import pdf_extractor
import pdf_text_extractor
from xml_parser import NfseEntry


def _fake_pdf(p: Path):
    p.write_bytes(b"%PDF-1.4\n%fake\n")


def _entry(nome: str, metodo: str = "ocr-local") -> NfseEntry:
    return NfseEntry(
        cnpj_tomador="02184341000270",
        numero_nf="1",
        chave_nf=None,
        source_file=nome,
        method=metodo,
    )


@pytest.fixture
def sem_texto_nativo(monkeypatch):
    """Forca todo PDF a falhar o passe 1, caindo para os passes de OCR."""
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: None)


def test_ocr_local_resolve_e_nao_chama_gemini(tmp_path, monkeypatch, sem_texto_nativo):
    """Com OCR local funcionando, o Gemini nao deve ser acionado — nem quando
    ha chave configurada. E o que tira a ferramenta da dependencia de cota."""
    _fake_pdf(tmp_path / "a.pdf")
    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr", lambda p: (_entry("a.pdf"), None))

    chamadas = []
    monkeypatch.setattr(pdf_extractor, "_call_gemini", lambda *a, **kw: chamadas.append(1) or "")

    entries, failed, stats = pdf_extractor.extract_from_directory(tmp_path, api_key="fake")

    assert [e.source_file for e in entries] == ["a.pdf"]
    assert failed == []
    assert chamadas == []
    assert stats["ocr_local"] == 1
    assert stats["ocr"] == 0


def test_gemini_so_recebe_o_que_o_ocr_local_nao_resolveu(tmp_path, monkeypatch, sem_texto_nativo):
    _fake_pdf(tmp_path / "resolve.pdf")
    _fake_pdf(tmp_path / "falha.pdf")

    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(
        ocr_local,
        "extract_local_ocr",
        lambda p: (_entry(p.name), None) if p.name == "resolve.pdf" else (None, "ilegivel"),
    )

    vistos = []

    def fake_gemini(path, *a, **kw):
        vistos.append(Path(path).name)
        return '{"cnpj_tomador": "02184341000270", "numero_nf": "9", "chave_nf": null}'

    monkeypatch.setattr(pdf_extractor, "_call_gemini", fake_gemini)

    entries, failed, stats = pdf_extractor.extract_from_directory(tmp_path, api_key="fake")

    assert vistos == ["falha.pdf"]  # o resolvido localmente nao passou pelo Gemini
    assert len(entries) == 2
    assert failed == []
    assert stats["ocr_local"] == 1
    assert stats["ocr"] == 1


def test_falha_nos_dois_passes_reporta_os_dois_motivos(tmp_path, monkeypatch, sem_texto_nativo):
    """O usuario precisa ver que ambos os caminhos foram tentados e por que
    cada um falhou — 'nao consegui' sozinho nao ajuda a agir."""
    _fake_pdf(tmp_path / "ruim.pdf")
    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr", lambda p: (None, "OCR local nao achou chave"))

    def explode(*a, **kw):
        raise RuntimeError("429 quota exceeded")

    monkeypatch.setattr(pdf_extractor, "_call_gemini", explode)

    entries, failed, _ = pdf_extractor.extract_from_directory(tmp_path, api_key="fake")

    assert entries == []
    assert len(failed) == 1
    assert failed[0]["file"] == "ruim.pdf"
    assert "OCR local nao achou chave" in failed[0]["reason"]
    assert "Quota" in failed[0]["reason"] or "quota" in failed[0]["reason"]


def test_sem_gemini_a_falha_do_ocr_local_e_o_motivo_reportado(tmp_path, monkeypatch, sem_texto_nativo):
    _fake_pdf(tmp_path / "ruim.pdf")
    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(
        ocr_local, "extract_local_ocr", lambda p: (None, "OCR local leu mas nao achou identidade")
    )

    entries, failed, _ = pdf_extractor.extract_from_directory(tmp_path, api_key=None)

    assert entries == []
    assert failed == [
        {"file": "ruim.pdf", "reason": "OCR local leu mas nao achou identidade"}
    ]


def test_excecao_no_ocr_local_nao_derruba_o_lote(tmp_path, monkeypatch, sem_texto_nativo):
    """Um PDF corrompido nao pode abortar o job inteiro."""
    _fake_pdf(tmp_path / "bomba.pdf")
    _fake_pdf(tmp_path / "ok.pdf")

    def as_vezes_explode(p):
        if p.name == "bomba.pdf":
            raise ValueError("pdf corrompido")
        return _entry(p.name), None

    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr", as_vezes_explode)

    entries, failed, _ = pdf_extractor.extract_from_directory(tmp_path, api_key=None)

    assert [e.source_file for e in entries] == ["ok.pdf"]
    assert len(failed) == 1
    assert failed[0]["file"] == "bomba.pdf"


def test_todo_arquivo_sai_como_entry_ou_como_falha(tmp_path, monkeypatch, sem_texto_nativo):
    """Invariante de fechamento: entregues == lidos + falhos. Sem sumico."""
    for i in range(6):
        _fake_pdf(tmp_path / f"f{i}.pdf")

    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(
        ocr_local,
        "extract_local_ocr",
        lambda p: (_entry(p.name), None) if p.name[1] in "024" else (None, "ilegivel"),
    )

    entries, failed, _ = pdf_extractor.extract_from_directory(tmp_path, api_key=None)

    assert len(entries) + len(failed) == 6
    assert {e.source_file for e in entries} | {f["file"] for f in failed} == {
        f"f{i}.pdf" for i in range(6)
    }


def test_progresso_conta_cada_arquivo_uma_vez(tmp_path, monkeypatch, sem_texto_nativo):
    """Arquivo que atravessa os tres passes nao pode contar tres vezes — a
    barra passaria de 100%."""
    for i in range(4):
        _fake_pdf(tmp_path / f"f{i}.pdf")

    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(ocr_local, "extract_local_ocr", lambda p: (None, "ilegivel"))
    monkeypatch.setattr(
        pdf_extractor,
        "_call_gemini",
        lambda *a, **kw: '{"cnpj_tomador": "02184341000270", "numero_nf": "9", "chave_nf": null}',
    )

    progresso = []
    pdf_extractor.extract_from_directory(
        tmp_path, api_key="fake", on_progress=lambda i, n, *a: progresso.append((i, n))
    )

    assert progresso[-1] == (4, 4)
    assert all(i <= n for i, n in progresso)


def test_progresso_informa_o_passe_atual(tmp_path, monkeypatch, sem_texto_nativo):
    """A barra e linear em contagem de arquivo, mas o passe de texto resolve a
    maioria em segundos e o de OCR leva ~20s cada. Sem saber o passe, o usuario
    ve os ultimos pontos congelarem e acha que travou. O progresso precisa
    dizer em qual passe esta e quantos faltam DENTRO dele.
    """
    for i in range(3):
        _fake_pdf(tmp_path / f"f{i}.pdf")

    monkeypatch.setattr(ocr_local, "available", lambda: True)
    monkeypatch.setattr(
        ocr_local,
        "extract_local_ocr",
        lambda p: (None, "ilegivel"),
    )
    monkeypatch.setattr(
        pdf_extractor,
        "_call_gemini",
        lambda *a, **kw: '{"cnpj_tomador": "02184341000270", "numero_nf": "9", "chave_nf": null}',
    )

    eventos = []
    pdf_extractor.extract_from_directory(
        tmp_path,
        api_key="fake",
        on_progress=lambda i, n, stage, sd, st: eventos.append((stage, sd, st)),
    )

    # Os 3 arquivos falham no texto e no OCR local, entao so o Gemini resolve.
    # A jornada que o usuario ve, na ordem: cada etapa se anuncia ao ENTRAR
    # (contador 0), mesmo quando nao resolve nada, e so a que resolve conta
    # 1..N. Sem o anuncio, a tela ficaria parada no rotulo da etapa anterior
    # durante todo o OCR — a confusao que este feedback existe para eliminar.
    assert eventos == [
        ("texto", 0, 3),
        ("ocr_local", 0, 3),
        ("ocr_gemini", 0, 3),
        ("ocr_gemini", 1, 3),
        ("ocr_gemini", 2, 3),
        ("ocr_gemini", 3, 3),
    ]
    assert all(sd <= st for _, sd, st in eventos)


def test_passe_de_texto_reporta_seu_proprio_passe(tmp_path, monkeypatch):
    """Quando o PDF tem texto nativo, o passe reportado e `texto` — e o total da
    etapa e o numero de PDFs, nao o do lote inteiro."""
    for i in range(2):
        _fake_pdf(tmp_path / f"f{i}.pdf")

    monkeypatch.setattr(
        pdf_extractor,
        "extract_from_pdf_local",
        lambda p: None,
        raising=False,
    )

    import pdf_text_extractor

    entry_falsa = NfseEntry(
        cnpj_tomador="02184341000270",
        numero_nf="1",
        chave_nf=None,
        source_file="f.pdf",
        method="local",
    )
    monkeypatch.setattr(pdf_text_extractor, "extract_from_pdf_local", lambda p: entry_falsa)

    eventos = []
    pdf_extractor.extract_from_directory(
        tmp_path,
        api_key=None,
        on_progress=lambda i, n, stage, sd, st: eventos.append((stage, sd, st)),
    )

    # anuncio (0) + um evento por arquivo concluido
    assert [e[0] for e in eventos] == ["texto", "texto", "texto"]
    assert [e[1] for e in eventos] == [0, 1, 2]
    assert [e[2] for e in eventos] == [2, 2, 2]
