"""Helper de nome dinamico do XLSX baseado em razao social do tomador + data/hora."""
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from filename import build_xlsx_filename, sanitize_filename_part
from xml_parser import NfseEntry


def _entry(razao_tomador=None, source="x.xml"):
    return NfseEntry(
        cnpj_tomador=None,
        numero_nf=None,
        chave_nf=None,
        source_file=source,
        razao_social_tomador=razao_tomador,
    )


def test_sanitize_remove_caracteres_invalidos():
    assert sanitize_filename_part('A/B\\C:D*E?F"G<H>I|J') == "A_B_C_D_E_F_G_H_I_J"


def test_sanitize_colapsa_espacos_e_corta():
    assert sanitize_filename_part("  Foo   Bar  ") == "Foo Bar"


def test_sanitize_string_vazia_vira_fallback():
    assert sanitize_filename_part("") == ""
    assert sanitize_filename_part(None) == ""  # type: ignore[arg-type]


def test_build_filename_com_razao_social():
    now = datetime(2026, 4, 28, 14, 35, 0)
    entries = [_entry(razao_tomador="ACME Industria LTDA")]
    name = build_xlsx_filename(entries, now=now)
    assert name == "Comparacao NFSE - ACME Industria LTDA - 2026-04-28 14h35.xlsx"


def test_build_filename_sem_razao_social_usa_fallback():
    now = datetime(2026, 4, 28, 9, 5, 0)
    entries = [_entry(razao_tomador=None)]
    name = build_xlsx_filename(entries, now=now)
    assert name == "Comparacao NFSE - 2026-04-28 09h05.xlsx"


def test_build_filename_pega_primeira_razao_disponivel_dos_entries():
    now = datetime(2026, 1, 2, 3, 4, 0)
    entries = [
        _entry(razao_tomador=None),
        _entry(razao_tomador="Empresa Real SA"),
        _entry(razao_tomador="Outro Tomador SA"),  # nao usado, primeiro vence
    ]
    name = build_xlsx_filename(entries, now=now)
    assert "Empresa Real SA" in name


def test_build_filename_corta_razao_social_muito_longa():
    now = datetime(2026, 4, 28, 14, 35, 0)
    entries = [_entry(razao_tomador="A" * 200)]
    name = build_xlsx_filename(entries, now=now)
    # Deve caber numa filename razoavel (< 200 chars, idealmente)
    assert len(name) <= 180


def test_build_filename_remove_caracteres_de_path():
    now = datetime(2026, 4, 28, 14, 35, 0)
    entries = [_entry(razao_tomador="Empresa / Filial: Sao Paulo")]
    name = build_xlsx_filename(entries, now=now)
    assert "/" not in name
    assert "\\" not in name
    assert ":" not in name.replace(":", "_") or ":" not in name
