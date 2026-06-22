"""Extracao local de NFS-e via pdfplumber + heuristicas regex.

Tenta extrair CNPJ tomador, numero e chave do TEXTO do PDF (sem chamar
nenhuma API). Se o PDF for so imagem (scan) ou tiver layout incomum, retorna
None e o caller deve cair no fallback de OCR (Gemini).

Filosofia: ser CONSERVADOR. Se houver duvida, retorna None — preferimos
gastar uma chamada de OCR a registrar dado errado.
"""
from __future__ import annotations

import re
import unicodedata
from pathlib import Path

from xml_parser import NfseEntry, display_name


# CNPJ pode aparecer como 12.345.678/0001-90 ou 12345678000190 (com ou sem mascara).
_CNPJ_RE = re.compile(r"\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\s/]?\d{4}[-\s]?\d{2})\b")
# Chave de acesso NFS-e (50 digitos) ou NFe (44 digitos).
_CHAVE_RE = re.compile(r"\b(\d{44}|\d{50})\b")
# Numero da NFS-e. pdfplumber as vezes cola tudo ("N�merodaNFS-e Compet..."),
# entao espacos sao opcionais e ate `da` pode vir grudado. Permitimos um gap
# largo antes do digito porque o header pode ter colunas (Competencia, Data,
# Hora) vindo ANTES do valor da NFS-e.
_NUMERO_PATTERNS = [
    re.compile(
        r"n.{0,5}mero(?:\s*da)?\s*(?:nfs[-\s]?e|nota(?:\s*fiscal)?)\b"
        r"[^\d]{0,120}?(\d{1,15})\b",
        re.IGNORECASE,
    ),
    # Fallback: "Nº 130", "No 130", "N° 130" (independente de NFS-e)
    re.compile(r"\bn[ºo°]\s*[:#]?\s*(\d{1,15})\b", re.IGNORECASE),
]

# Texto util minimo: PDF de scan retorna 0 ou pouquissimos chars; abaixo disso
# vai direto pra OCR. 100 chars cobre PDFs vazios/quase-vazios sem rejeitar
# notas curtas legitimas.
_MIN_TEXT_LEN = 100


def _normalize(text: str) -> str:
    """Minusculas + sem diacriticos para matching tolerante."""
    nfkd = unicodedata.normalize("NFKD", text)
    return "".join(c for c in nfkd if not unicodedata.combining(c)).lower()


def extract_text(pdf_path: Path) -> str | None:
    """Le todo o texto do PDF. Retorna None se for image-only ou ilegivel."""
    try:
        import pdfplumber
    except ImportError:
        return None

    try:
        parts: list[str] = []
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                t = page.extract_text() or ""
                parts.append(t)
    except Exception:
        return None

    full = "\n".join(parts).strip()
    if len(full) < _MIN_TEXT_LEN:
        return None
    return full


def _normalize_cnpj(raw: str) -> str | None:
    digits = re.sub(r"\D", "", raw)
    return digits if len(digits) == 14 else None


def _find_prestador(text: str) -> tuple[str | None, str | None]:
    """Localiza CNPJ + Razao Social do PRESTADOR no inicio da nota.

    Heuristica: procura uma das marcacoes ("prestador de servico",
    "razao social"/"prestador") e captura no bloco subsequente o CNPJ e
    uma linha plausivel de razao social (ate proxima secao).
    """
    norm = _normalize(text)
    # Diferentes marcadores comuns em NFS-e municipais
    markers = ("prestador de servico", "prestadordeservico", "dados do prestador")
    idx = -1
    for m in markers:
        idx = norm.find(m)
        if idx >= 0:
            break
    if idx < 0:
        return None, None

    bound_keys = ("tomador", "intermediario", "servico prestado", "discriminacao")
    end = len(text)
    for k in bound_keys:
        j = norm.find(k, idx + 1)
        if 0 < j < end:
            end = j

    region = text[idx:end]
    cnpj = None
    for m in _CNPJ_RE.finditer(region):
        c = _normalize_cnpj(m.group(1))
        if c:
            cnpj = c
            break

    # Razao social: linha que comeca depois do label "razao social" / "nome"
    # E nao contem digitos demais. Heuristica conservadora.
    razao = None
    region_norm = _normalize(region)
    for label in ("razao social", "razaosocial", "nome empresarial", "nome/razao"):
        li = region_norm.find(label)
        if li < 0:
            continue
        # Pega ate ~120 chars apos o label
        snippet = region[li + len(label) : li + len(label) + 200]
        # Primeira linha nao-vazia, removendo pontuacao residual
        for raw_line in snippet.splitlines():
            line = raw_line.strip(" :\t-")
            if not line:
                continue
            # Rejeita linhas mais numericas que letras (provavelmente um CNPJ ou data)
            digits = sum(1 for c in line if c.isdigit())
            letters = sum(1 for c in line if c.isalpha())
            if letters > digits and 3 <= len(line) <= 120:
                razao = line
                break
        if razao:
            break

    return cnpj, razao


def _find_tomador_razao(text: str) -> str | None:
    """Razao social dentro da secao TOMADOR. Heuristica conservadora."""
    norm = _normalize(text)
    idx = norm.find("tomador")
    if idx < 0:
        return None
    bound_keys = ("intermediario", "servico prestado", "valor total", "discriminacao")
    end = len(text)
    for k in bound_keys:
        j = norm.find(k, idx + 1)
        if 0 < j < end:
            end = j
    region = text[idx:end]
    region_norm = _normalize(region)
    for label in ("razao social", "razaosocial", "nome empresarial", "nome/razao"):
        li = region_norm.find(label)
        if li < 0:
            continue
        snippet = region[li + len(label) : li + len(label) + 200]
        for raw_line in snippet.splitlines():
            line = raw_line.strip(" :\t-")
            if not line:
                continue
            digits = sum(1 for c in line if c.isdigit())
            letters = sum(1 for c in line if c.isalpha())
            if letters > digits and 3 <= len(line) <= 120:
                return line
    return None


def _find_tomador_cnpj(text: str) -> str | None:
    """Localiza o CNPJ dentro da secao TOMADOR — ignorando o do Prestador.

    Estrategia: posicao de 'tomador' no texto; busca CNPJs ate o proximo
    marcador de secao (intermediario, servico, valor, descricao, discrimina).
    """
    norm = _normalize(text)
    idx = norm.find("tomador")
    if idx < 0:
        return None

    # Limites usuais do bloco do tomador. Pego o primeiro que ocorrer apos.
    bound_keys = (
        "intermediario",
        "servico prestado",
        "servicoprestado",
        "valor total",
        "valortotal",
        "discriminacao",
        "descricao do servico",
        "descricaodoservico",
        "tributacao",
    )
    end = len(text)
    for k in bound_keys:
        j = norm.find(k, idx + len("tomador"))
        if 0 < j < end:
            end = j

    region = text[idx:end]
    for m in _CNPJ_RE.finditer(region):
        cnpj = _normalize_cnpj(m.group(1))
        if cnpj:
            return cnpj
    return None


def _find_numero(text: str) -> str | None:
    for pattern in _NUMERO_PATTERNS:
        m = pattern.search(text)
        if m:
            num = m.group(1).lstrip("0") or "0"
            return num
    return None


def _find_chave(text: str) -> str | None:
    # Procura chave proxima de "chave de acesso" / "chave da nfs"
    norm = _normalize(text)
    for marker in ("chave de acesso", "chavedeacesso", "chave da nfs", "chavedanfs"):
        i = norm.find(marker)
        if i >= 0:
            window = text[i : i + 400]
            m = _CHAVE_RE.search(window)
            if m:
                return m.group(1)
    # Sem marcador: aceita qualquer chave bem-formada no documento todo.
    m = _CHAVE_RE.search(text)
    return m.group(1) if m else None


def extract_from_pdf_local(pdf_path: Path) -> NfseEntry | None:
    """Extrai NfseEntry localmente. Retorna None se faltar info minima.

    Confianca minima: precisa ter `chave` OU `(cnpj_tomador + numero)`. Caso
    contrario o caller cai no Gemini.
    """
    text = extract_text(pdf_path)
    if text is None:
        return None

    cnpj = _find_tomador_cnpj(text)
    numero = _find_numero(text)
    chave = _find_chave(text)
    cnpj_pres, razao = _find_prestador(text)
    razao_tom = _find_tomador_razao(text)

    has_pair = bool(cnpj and numero)
    if not chave and not has_pair:
        return None

    return NfseEntry(
        cnpj_tomador=cnpj,
        numero_nf=numero,
        chave_nf=chave,
        source_file=display_name(pdf_path.name),
        method="local",
        cnpj_prestador=cnpj_pres,
        razao_social_prestador=razao,
        razao_social_tomador=razao_tom,
    )
