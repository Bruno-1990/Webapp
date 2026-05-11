"""Paridade: três abas (Produtos, Base, Consolidado (SCI)) e somas após groupby."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pandas as pd
import pytest

from transformador import TransformadorProdutos


FIXTURES = Path(__file__).parent / "fixtures"


def test_three_sheets_and_groupby_sums():
    csv_path = FIXTURES / "minimal_sci.csv"
    assert csv_path.is_file()

    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "out.xlsx"
        job = TransformadorProdutos(
            caminho_sci=str(csv_path),
            caminho_saida=str(out),
            sheet_name=None,
        )
        job.executar(progress=None)

        assert out.is_file()
        sheets = pd.read_excel(out, sheet_name=None)
        assert isinstance(sheets, dict)
        assert set(sheets.keys()) == {"Produtos", "Base", "Consolidado (SCI)"}

        cons = sheets["Consolidado (SCI)"]
        # Duas linhas no CSV com mesma trinca CNPJ + NF + CFOP devem virar uma linha somada
        assert len(cons) == 1
        row = cons.iloc[0]
        assert int(row["Nº NF."]) == 1
        assert float(row["Vlr contábil"]) == pytest.approx(300.0)
        assert float(row["Base de ICMS"]) == pytest.approx(200.0)


def test_multi_sheet_workbook_first_sheet_sorted_by_name(tmp_path: Path):
    """Sem --sheet: usa primeira aba por ordem lexicográfica dos nomes."""
    p = tmp_path / "multi.xlsx"
    with pd.ExcelWriter(p, engine="openpyxl") as w:
        pd.DataFrame({"X": [1]}).to_excel(w, sheet_name="ZZZ", index=False)
        pd.DataFrame(
            {
                "CNPJ DO PARTICIPANTE": ["123"],
                "Nº NF.": [5],
                "CFOP": ["5102"],
                "VLR CONTABIL": [10.0],
                "BASE DE ICMS": [0],
                "VALOR DO ICMS": [0],
                "BASE DE IPI": [0],
                "VALOR DO IPI": [0],
            }
        ).to_excel(w, sheet_name="AAA", index=False)

    out = tmp_path / "out.xlsx"
    job = TransformadorProdutos(
        caminho_sci=str(p),
        caminho_saida=str(out),
        sheet_name=None,
    )
    job.executar(progress=None)

    cons = pd.read_excel(out, sheet_name="Consolidado (SCI)")
    assert len(cons) == 1
    assert int(cons.iloc[0]["Nº NF."]) == 5
