"""Parser tolerante de NFS-e.

Suporta dois grandes padroes:
  1. ABRASF v2.04 (legado): <TomadorServico>, <Numero>, <ChaveAcesso>
  2. Padrao nacional 2024+ (xmlns sped.fazenda.gov.br/nfse):
     <infNFSe Id="NFS{50_digitos}">, <nNFSe>, <toma><CNPJ>

Usa xml.etree da stdlib (sem lxml). Ignora namespace olhando so o tag local.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class NfseEntry:
    cnpj_tomador: str | None
    numero_nf: str | None
    chave_nf: str | None
    source_file: str
    method: str | None = None  # "local"/"ocr" para PDFs; None para XMLs
    cnpj_prestador: str | None = None
    razao_social_prestador: str | None = None
    razao_social_tomador: str | None = None

    def to_dict(self) -> dict:
        d = asdict(self)
        return {
            "cnpjTomador": d["cnpj_tomador"],
            "numeroNf": d["numero_nf"],
            "chaveNf": d["chave_nf"],
            "sourceFile": d["source_file"],
            "method": d.get("method"),
            "cnpjPrestador": d.get("cnpj_prestador"),
            "razaoSocialPrestador": d.get("razao_social_prestador"),
            "razaoSocialTomador": d.get("razao_social_tomador"),
        }


# ─── Helpers ─────────────────────────────────────────────────────────────────

_DIGITS_RE = re.compile(r"\D")
# Prioriza 50 digitos (NFS-e nacional 2024+) sobre 44 (NFe). Regex tenta
# alternativas da esquerda para a direita — ordem importa.
_CHAVE_RE = re.compile(r"(\d{50}|\d{44})")

# Prefixo `<8 hex>_` que a API adiciona aos uploads pra evitar colisao em
# disco. Usado SO no source_file exibido — o arquivo no disco mantem o
# prefixo para uniqueness. Ex.: "b8ebb04_3133...xml" -> "3133...xml".
_UPLOAD_PREFIX_RE = re.compile(r"^[0-9a-f]{8}_", re.IGNORECASE)


def display_name(filename: str) -> str:
    """Remove o prefixo de upload (`<8 hex>_`) se houver. Mantem nome puro."""
    return _UPLOAD_PREFIX_RE.sub("", filename, count=1)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _digits_only(value: str | None) -> str | None:
    if not value:
        return None
    only = _DIGITS_RE.sub("", value)
    return only or None


def _find_first_text(root: ET.Element, names: Iterable[str]) -> str | None:
    targets = {n.lower() for n in names}
    for el in root.iter():
        if _local(el.tag).lower() in targets:
            txt = (el.text or "").strip()
            if txt:
                return txt
    return None


# ─── Chave de acesso ─────────────────────────────────────────────────────────

# Nomes de elementos comuns (ABRASF e variacoes municipais).
_CHAVE_ELEMENT_NAMES = (
    "ChaveAcesso", "ChaveDeAcesso",
    "ChaveNfse", "ChaveNFSe", "ChaveNfe", "ChaveNFe",
    "chNFSe", "chNFe", "ChNfse", "ChNfe",
    "NfseChave",
)

# Elementos cujo atributo Id costuma carregar a chave (padrao nacional 2024+).
_ID_BEARING_ELEMENTS = ("infNFSe", "InfNfse", "Nfse", "NFSe")


def _find_chave_in_attributes(root: ET.Element) -> str | None:
    """Padrao nacional: <infNFSe Id="NFS{50_digitos}">. O Id pode ter prefixo
    alfabetico (ex.: 'NFS') que precisa ser ignorado.
    """
    for el in root.iter():
        if _local(el.tag) not in _ID_BEARING_ELEMENTS and _local(el.tag).lower() != "infnfse":
            # Tambem aceita qualquer elemento com Id casando o padrao
            pass
        for attr_name in ("Id", "id", "ID"):
            v = el.get(attr_name)
            if not v:
                continue
            digits = _digits_only(v)
            if not digits:
                continue
            m = _CHAVE_RE.search(digits)
            if m:
                cand = m.group(1)
                if len(cand) in (44, 50):
                    return cand
    return None


def _find_chave_in_text(root: ET.Element) -> str | None:
    """Fallback: qualquer elemento cujo TEXTO seja 44 ou 50 digitos."""
    for el in root.iter():
        txt = (el.text or "").strip()
        if not txt:
            continue
        digits = _digits_only(txt)
        if digits and len(digits) in (44, 50):
            return digits
    return None


def _find_chave(root: ET.Element) -> str | None:
    # 1) Por nome de elemento conhecido
    raw = _find_first_text(root, _CHAVE_ELEMENT_NAMES)
    if raw:
        digits = _digits_only(raw)
        if digits and len(digits) in (44, 50):
            return digits

    # 2) Por atributo Id (padrao nacional)
    cand = _find_chave_in_attributes(root)
    if cand:
        return cand

    # 3) Fallback: texto de qualquer elemento
    return _find_chave_in_text(root)


# ─── Numero da NFS-e ─────────────────────────────────────────────────────────

_NUMERO_NAMES = (
    "nNFSe", "nNfse",          # padrao nacional
    "Numero", "NumeroNfse", "NumeroNFSe", "NumeroNota",
    "NumeroDocumento", "Numero_Nf", "Nro", "NroNFSe",
    "NfseNumero",
)


def _find_numero(root: ET.Element) -> str | None:
    raw = _find_first_text(root, _NUMERO_NAMES)
    if raw:
        digits = _digits_only(raw)
        if digits:
            return digits.lstrip("0") or "0"
    return None


# ─── CNPJ Tomador ────────────────────────────────────────────────────────────

# Wrappers do tomador. ABRASF: <TomadorServico>. Nacional: <toma>.
_TOMADOR_WRAPPER_NAMES = ("TomadorServico", "Tomador", "toma", "DadosTomador", "IdentTomador")


def _find_tomador_razao_social(root: ET.Element) -> str | None:
    """Extrai Razao Social do bloco TomadorServico (ABRASF/nacional)."""
    wrapper_targets = {n.lower() for n in _TOMADOR_WRAPPER_NAMES}
    razao_targets = {"razaosocial", "xnome", "nome", "xrazao"}

    for el in root.iter():
        name = _local(el.tag).lower()
        if name not in wrapper_targets and "tomador" not in name and name != "toma":
            continue
        for child in el.iter():
            if _local(child.tag).lower() in razao_targets:
                txt = (child.text or "").strip()
                if txt:
                    return txt
    return None


def _find_tomador_cnpj(root: ET.Element) -> str | None:
    """Procura CNPJ dentro do bloco do Tomador. Ignora <Cpf>/<CPF> de PF.

    NOTA importante para o padrao nacional: existe `<emit>` (Prestador) e
    `<prest>` (Prestador) com CNPJ TAMBEM. Nao confundir — so olhamos dentro
    de elementos que casam com nomes de tomador.
    """
    wrapper_targets = {n.lower() for n in _TOMADOR_WRAPPER_NAMES}

    for el in root.iter():
        name = _local(el.tag).lower()
        # Aceita match exato (toma, tomador, etc) ou substring (tomadorservico,
        # dadostomador). Importante: NAO pode matchear "automaticamente" coisas
        # tipo "tomadorprovedor" etc, mas como sao nomes raros ignoramos.
        if name not in wrapper_targets and "tomador" not in name and name != "toma":
            continue

        for child in el.iter():
            cname = _local(child.tag).lower()
            # ABRASF: <CpfCnpj><Cnpj>...; Nacional: <CNPJ>...
            if cname == "cnpj" or cname.endswith("cnpj"):
                txt = (child.text or "").strip()
                norm = _digits_only(txt)
                if norm and len(norm) == 14:
                    return norm
    return None


# ─── Prestador (CNPJ + Razao Social) ─────────────────────────────────────────

# ABRASF: <PrestadorServico>. Nacional: <prest>/<emit>.
_PRESTADOR_WRAPPER_NAMES = (
    "PrestadorServico", "Prestador", "prest", "emit",
    "DadosPrestador", "IdentPrestador",
)

# Tags possiveis para Razao Social (preferindo as do prestador). NaoExige
# match exato — buscamos dentro do wrapper do prestador.
_RAZAO_TAG_NAMES = (
    "RazaoSocial", "razaoSocial", "RazaoSocialPrestador",
    "xNome", "Nome", "xRazao", "NomeFantasia",
)


def _is_prestador_wrapper(name: str) -> bool:
    n = name.lower()
    if n in {w.lower() for w in _PRESTADOR_WRAPPER_NAMES}:
        return True
    # Casa "prestadorservico", "dadosprestador", etc — mas NAO "tomador*".
    if "tomador" in n or n == "toma":
        return False
    return "prestador" in n or n in {"emit", "prest"}


def _find_prestador(root: ET.Element) -> tuple[str | None, str | None]:
    """Retorna (cnpj_prestador, razao_social_prestador) varrendo o wrapper.

    Quando encontra mais de um wrapper (raro), usa o primeiro com CNPJ valido.
    Razao social: pega do mesmo wrapper se houver.
    """
    razao_targets = {t.lower() for t in _RAZAO_TAG_NAMES}

    for el in root.iter():
        if not _is_prestador_wrapper(_local(el.tag)):
            continue
        cnpj: str | None = None
        razao: str | None = None
        for child in el.iter():
            cname = _local(child.tag).lower()
            if cnpj is None and (cname == "cnpj" or cname.endswith("cnpj")):
                norm = _digits_only((child.text or "").strip())
                if norm and len(norm) == 14:
                    cnpj = norm
            if razao is None and cname in razao_targets:
                txt = (child.text or "").strip()
                if txt:
                    razao = txt
        if cnpj or razao:
            return cnpj, razao
    return None, None


# ─── API publica ─────────────────────────────────────────────────────────────


def parse_nfse_xml(path: str | Path) -> NfseEntry | None:
    p = Path(path)
    try:
        tree = ET.parse(p)
    except ET.ParseError:
        return None
    except (OSError, UnicodeDecodeError):
        return None

    root = tree.getroot()
    numero = _find_numero(root)
    chave = _find_chave(root)
    cnpj = _find_tomador_cnpj(root)
    razao_tomador = _find_tomador_razao_social(root)
    cnpj_prestador, razao_social = _find_prestador(root)

    if (
        numero is None
        and chave is None
        and cnpj is None
        and cnpj_prestador is None
        and razao_social is None
        and razao_tomador is None
    ):
        return None

    return NfseEntry(
        cnpj_tomador=cnpj,
        numero_nf=numero,
        chave_nf=chave,
        source_file=display_name(p.name),
        cnpj_prestador=cnpj_prestador,
        razao_social_prestador=razao_social,
        razao_social_tomador=razao_tomador,
    )


def parse_nfse_directory(
    directory: str | Path,
) -> tuple[list[NfseEntry], list[str]]:
    """Processa todos os .xml do diretorio (recursivo). Retorna (entries, ignorados)."""
    base = Path(directory)
    entries: list[NfseEntry] = []
    ignorados: list[str] = []
    if not base.exists():
        return entries, ignorados
    for xml in sorted(base.rglob("*.xml")):
        e = parse_nfse_xml(xml)
        if e is None:
            ignorados.append(display_name(xml.name))
        else:
            entries.append(e)
    return entries, ignorados
