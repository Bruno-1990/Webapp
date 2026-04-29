"""Parser de NFS-e: extrai CNPJ tomador, Numero NF e Chave NF."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from xml_parser import NfseEntry, parse_nfse_xml, parse_nfse_directory

FIX = Path(__file__).parent / "fixtures"


def test_abrasf_completo():
    entry = parse_nfse_xml(FIX / "nfse_abrasf.xml")
    assert entry is not None
    assert entry.cnpj_tomador == "99888777000166"
    assert entry.numero_nf == "100001"
    assert entry.chave_nf == "35260311222333000181551000001000000001000000001234"
    assert entry.source_file == "nfse_abrasf.xml"
    assert entry.cnpj_prestador == "11222333000181"
    assert entry.razao_social_prestador == "Prestador LTDA"
    assert entry.razao_social_tomador == "Tomador Exemplo SA"


def test_sem_chave_cai_para_cnpj_numero():
    entry = parse_nfse_xml(FIX / "nfse_sem_chave.xml")
    assert entry is not None
    assert entry.cnpj_tomador == "55666777000155"
    assert entry.numero_nf == "200002"
    assert entry.chave_nf is None
    # Fixture tem so o CNPJ do prestador (sem RazaoSocial)
    assert entry.cnpj_prestador == "11222333000181"
    assert entry.razao_social_prestador is None


def test_tomador_com_cpf():
    """Quando tomador tem CPF (pessoa fisica), cnpj_tomador fica None."""
    entry = parse_nfse_xml(FIX / "nfse_tomador_cpf.xml")
    assert entry is not None
    assert entry.cnpj_tomador is None
    assert entry.numero_nf == "300003"
    assert entry.chave_nf == "11112222333344445555666677778888999900001111"
    # Esse fixture nao tem prestador
    assert entry.cnpj_prestador is None
    assert entry.razao_social_prestador is None


def test_malformado_retorna_none_sem_crashar():
    entry = parse_nfse_xml(FIX / "malformado.xml")
    assert entry is None


def test_parse_directory_pula_invalidos():
    entries, ignored = parse_nfse_directory(FIX)
    numeros = {e.numero_nf for e in entries}
    assert {"100001", "200002", "300003"} <= numeros
    assert "malformado.xml" in ignored


def test_nfse_entry_to_dict():
    entry = NfseEntry(
        cnpj_tomador="123",
        numero_nf="1",
        chave_nf="abc",
        source_file="x.xml",
        cnpj_prestador="999",
        razao_social_prestador="ACME LTDA",
    )
    d = entry.to_dict()
    assert d == {
        "cnpjTomador": "123",
        "numeroNf": "1",
        "chaveNf": "abc",
        "sourceFile": "x.xml",
        "method": None,
        "cnpjPrestador": "999",
        "razaoSocialPrestador": "ACME LTDA",
        "razaoSocialTomador": None,
    }
