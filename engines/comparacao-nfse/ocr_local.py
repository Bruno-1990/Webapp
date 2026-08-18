"""OCR 100% local: rasteriza o PDF e le o bitmap, sem API externa.

Por que existe: boa parte das NFS-e municipais chega como PDF "sem texto" —
nao por ser scan, mas por ter o conteudo em curvas vetoriais (texto convertido
em contorno) ou fonte sem mapa Unicode. O pdfplumber devolve nada ou lixo, e
o unico caminho e olhar os pixels.

Pipeline:
  1. PyMuPDF rasteriza a pagina (resolve curva vetorial E imagem embutida)
  2. RapidOCR (ONNX, CPU, sem binario de sistema) devolve texto COM coordenadas
  3. As coordenadas viram extracao por posicao: rotulo -> valor

O passo 3 e o motivo de valer a pena. DANFSe e um formulario tabular: o rotulo
("N da Nota Fiscal") fica numa celula e o valor noutra, logo abaixo. Texto
linearizado perde essa relacao e os regexes acabam pescando digito de vizinho
errado (ja aconteceu: numero da nota capturado de dentro de um CNPJ). Com
bounding box da para exigir que o valor esteja ABAIXO ou A DIREITA do rotulo.

Escala em DPI: comecamos em 300 e subimos para 400 se a pagina nao render nada
identificavel. Preferimos gastar segundos a perder uma nota.
"""
from __future__ import annotations

import os
import re
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path

from chave_nfse import aceitar_chave_ocr
from xml_parser import NfseEntry, display_name

# ─── Configuracao ────────────────────────────────────────────────────────────


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def dpi_ladder() -> tuple[int, ...]:
    """DPIs tentados em ordem. Sobe so quando a leitura anterior falhou."""
    first = _env_int("NFSE_OCR_LOCAL_DPI", 300)
    retry = _env_int("NFSE_OCR_LOCAL_DPI_RETRY", 400)
    return (first, retry) if retry > first else (first,)


def max_pages() -> int:
    """NFS-e e quase sempre 1 pagina; o resto costuma ser anexo."""
    return max(1, _env_int("NFSE_OCR_LOCAL_MAX_PAGES", 2))


def concurrency() -> int:
    """OCR local e CPU-bound (ao contrario da chamada de rede ao Gemini).

    Paralelismo alem dos nucleos so gera disputa. Deixamos um nucleo livre
    para o resto do worker.
    """
    raw = os.environ.get("NFSE_OCR_LOCAL_CONCURRENCY", "").strip()
    if raw:
        try:
            return max(1, min(int(raw), 32))
        except ValueError:
            pass
    return max(1, (os.cpu_count() or 2) - 1)


# ─── Disponibilidade (import lazy: deps sao opcionais) ───────────────────────

_engine_local = threading.local()


def available() -> bool:
    """True se as dependencias de OCR local estao instaladas."""
    try:
        import numpy  # noqa: F401
        import rapidocr_onnxruntime  # noqa: F401

        _import_fitz()
        return True
    except Exception:
        return False


def _import_fitz():
    """PyMuPDF expoe `fitz` (legado) e `pymupdf` (novo). Aceita os dois."""
    try:
        import fitz  # type: ignore

        return fitz
    except ImportError:
        import pymupdf as fitz  # type: ignore

        return fitz


def _get_engine():
    """RapidOCR por thread. A sessao ONNX carrega uma vez e e reutilizada."""
    eng = getattr(_engine_local, "engine", None)
    if eng is None:
        from rapidocr_onnxruntime import RapidOCR

        eng = RapidOCR()
        _engine_local.engine = eng
    return eng


# ─── Caixa de texto ──────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Box:
    """Trecho de texto reconhecido, com sua posicao na pagina (pixels)."""

    text: str
    x0: float
    y0: float
    x1: float
    y1: float

    @property
    def cx(self) -> float:
        return (self.x0 + self.x1) / 2

    @property
    def cy(self) -> float:
        return (self.y0 + self.y1) / 2

    @property
    def height(self) -> float:
        return max(1.0, self.y1 - self.y0)

    @property
    def norm(self) -> str:
        return _normalize(self.text)


def _normalize(text: str) -> str:
    """Minusculas, sem acento, pontuacao virando espaco.

    "N° da Nota Fiscal" -> "n da nota fiscal"; "Numero NFS-e" -> "numero nfs e".
    """
    nfkd = unicodedata.normalize("NFKD", text)
    plain = "".join(c for c in nfkd if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", plain).strip()


def _digits(text: str) -> str:
    return re.sub(r"\D", "", text)


# ─── Render + OCR ────────────────────────────────────────────────────────────


def render_page(pdf_path: Path, page_index: int, dpi: int):
    """Rasteriza uma pagina para ndarray BGR (formato que o RapidOCR espera)."""
    import cv2
    import numpy as np

    fitz = _import_fitz()
    with fitz.open(pdf_path) as doc:
        if page_index >= doc.page_count:
            return None
        pix = doc[page_index].get_pixmap(dpi=dpi)
        buf = np.frombuffer(pix.samples, dtype=np.uint8)
        img = buf.reshape(pix.height, pix.width, pix.n)
        if pix.n == 4:
            return cv2.cvtColor(img, cv2.COLOR_RGBA2BGR)
        if pix.n == 1:
            return cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        return cv2.cvtColor(img, cv2.COLOR_RGB2BGR)


def read_image(img) -> list[Box]:
    """Roda o OCR e devolve as caixas ordenadas em ordem de leitura."""
    result, _ = _get_engine()(img)
    if not result:
        return []
    boxes: list[Box] = []
    for quad, text, _score in result:
        xs = [p[0] for p in quad]
        ys = [p[1] for p in quad]
        boxes.append(Box(text, min(xs), min(ys), max(xs), max(ys)))
    boxes.sort(key=lambda b: (b.y0, b.x0))
    return boxes


def linear_text(boxes: list[Box]) -> str:
    """Reconstroi texto em linhas, agrupando caixas de altura semelhante.

    Serve de rede: quando a extracao por posicao nao acha um campo, caimos
    nos regexes ja existentes do pdf_text_extractor sobre este texto.
    """
    if not boxes:
        return ""
    tol = max(6.0, sum(b.height for b in boxes) / len(boxes) * 0.6)
    linhas: list[list[Box]] = []
    for b in sorted(boxes, key=lambda b: (b.cy, b.x0)):
        if linhas and abs(b.cy - linhas[-1][-1].cy) <= tol:
            linhas[-1].append(b)
        else:
            linhas.append([b])
    return "\n".join(" ".join(x.text for x in sorted(l, key=lambda b: b.x0)) for l in linhas)


# ─── Extracao por posicao ────────────────────────────────────────────────────

# Rotulos do numero da nota. Excluimos RPS e "integral" de proposito: sao
# outros numeros que convivem na mesma tabela e ja causaram troca.
_RE_LABEL_NUMERO = re.compile(
    r"\b(?:n|no|num|numero)\b(?:\s+d[ao])?\s+(?:nota|nfs)\b|\bnumero\s+nfs\b"
)
_RE_LABEL_NUMERO_VETO = re.compile(r"\brps\b|\bintegral\b|\bserie\b|\bcontrole\b")

# Valor plausivel de numero de nota: digitos puros, tolerando "43/2026".
_RE_VALOR_NUMERO = re.compile(r"^(\d{1,15})(?:\s*/\s*\d{2,4})?$")

_RE_CNPJ = re.compile(r"\b(\d{2}[.\s]?\d{3}[.\s]?\d{3}[\s/]?\d{4}[-\s]?\d{2})\b")

_SECOES_TOMADOR = ("tomador",)
_SECOES_PRESTADOR = ("prestador", "emitente")
# Cabecalhos que encerram um bloco. Ordem nao importa; usamos o mais proximo.
_SECOES_LIMITE = (
    "tomador",
    "prestador",
    "emitente",
    "intermediario",
    "servico",
    "servicos",
    "discriminacao",
    "valor total",
    "valores",
    "tributos",
    "construcao civil",
)


def _is_section_header(box: Box, nomes: tuple[str, ...]) -> bool:
    """Cabecalho de secao e uma caixa CURTA cujo texto e o nome da secao.

    Exigir texto curto evita casar com uma frase que apenas menciona a palavra
    ("RECEBEMOS DO TOMADOR..."), que apareceria no meio do documento.
    """
    n = box.norm
    if len(n) > 40:
        return False
    return any(re.search(rf"\b{re.escape(nome)}\b", n) for nome in nomes)


def _section_bounds(boxes: list[Box], nomes: tuple[str, ...]) -> tuple[float, float] | None:
    """Faixa vertical [inicio, fim) do bloco da secao."""
    inicio: float | None = None
    for b in boxes:
        if _is_section_header(b, nomes):
            inicio = b.y1
            break
    if inicio is None:
        return None
    fim = float("inf")
    for b in boxes:
        if b.y0 <= inicio:
            continue
        if _is_section_header(b, _SECOES_LIMITE) and not _is_section_header(b, nomes):
            fim = min(fim, b.y0)
    return inicio, fim


def _in_band(box: Box, band: tuple[float, float]) -> bool:
    return band[0] <= box.cy < band[1]


def _candidatos_valor(boxes: list[Box], label: Box) -> list[Box]:
    """Caixas que podem conter o valor do rotulo, mais provaveis primeiro.

    Prioriza ABAIXO (layout de tabela, dominante em DANFSe) sobre A DIREITA.
    """
    abaixo: list[tuple[float, Box]] = []
    direita: list[tuple[float, Box]] = []
    largura_label = max(1.0, label.x1 - label.x0)

    for b in boxes:
        if b is label:
            continue
        # Abaixo: precisa haver sobreposicao horizontal com o rotulo (mesma coluna)
        overlap = min(b.x1, label.x1) - max(b.x0, label.x0)
        if b.y0 >= label.y1 - label.height * 0.3 and overlap > largura_label * 0.25:
            abaixo.append((b.y0 - label.y1, b))
        # A direita: mesma linha
        elif abs(b.cy - label.cy) <= label.height * 0.7 and b.x0 >= label.x1:
            direita.append((b.x0 - label.x1, b))

    abaixo.sort(key=lambda t: t[0])
    direita.sort(key=lambda t: t[0])
    return [b for _, b in abaixo] + [b for _, b in direita]


def find_numero(boxes: list[Box]) -> str | None:
    """Numero da nota via rotulo -> valor por posicao."""
    labels = [
        b
        for b in boxes
        if _RE_LABEL_NUMERO.search(b.norm) and not _RE_LABEL_NUMERO_VETO.search(b.norm)
    ]
    for label in labels:
        for cand in _candidatos_valor(boxes, label)[:6]:
            texto = cand.text.strip()
            m = _RE_VALOR_NUMERO.match(texto)
            if m:
                return m.group(1).lstrip("0") or "0"
    return None


def find_cnpj_em_secao(boxes: list[Box], nomes: tuple[str, ...]) -> str | None:
    """Primeiro CNPJ valido dentro do bloco da secao."""
    band = _section_bounds(boxes, nomes)
    if band is None:
        return None
    for b in sorted((x for x in boxes if _in_band(x, band)), key=lambda x: (x.y0, x.x0)):
        for m in _RE_CNPJ.finditer(b.text):
            d = _digits(m.group(1))
            if len(d) == 14:
                return d
    return None


def find_razao_em_secao(boxes: list[Box], nomes: tuple[str, ...]) -> str | None:
    """Razao social do bloco: valor do rotulo, ou o texto mais 'nominal' dele."""
    band = _section_bounds(boxes, nomes)
    if band is None:
        return None
    na_secao = [b for b in boxes if _in_band(b, band)]

    for b in na_secao:
        if re.search(r"\b(razao social|nome empresarial|nome razao|razao)\b", b.norm):
            # O proprio rotulo pode ja conter o valor ("Razao Social: ACME LTDA")
            inline = re.split(r"(?i)raz[aã]o\s*social\s*:?", b.text, maxsplit=1)
            if len(inline) > 1 and len(inline[1].strip()) >= 3:
                return inline[1].strip()
            for cand in _candidatos_valor(na_secao, b)[:4]:
                if _parece_nome(cand.text):
                    return cand.text.strip()

    melhor = max((b for b in na_secao if _parece_nome(b.text)), key=lambda b: len(b.text), default=None)
    return melhor.text.strip() if melhor else None


def _parece_nome(texto: str) -> bool:
    t = texto.strip()
    if not (3 <= len(t) <= 120):
        return False
    letras = sum(1 for c in t if c.isalpha())
    digitos = sum(1 for c in t if c.isdigit())
    return letras > digitos and letras >= 3


def find_chave(boxes: list[Box]) -> str | None:
    """Chave de 44/50 digitos, isolada ou quebrada em caixas da mesma linha."""
    for b in boxes:
        d = _digits(b.text)
        if len(d) in (44, 50):
            return d

    # OCR costuma partir sequencias longas. Reconstroi por linha.
    tol = max(6.0, sum(b.height for b in boxes) / max(1, len(boxes)) * 0.6)
    linhas: list[list[Box]] = []
    for b in sorted(boxes, key=lambda b: (b.cy, b.x0)):
        if linhas and abs(b.cy - linhas[-1][-1].cy) <= tol:
            linhas[-1].append(b)
        else:
            linhas.append([b])
    for linha in linhas:
        juntos = "".join(_digits(x.text) for x in sorted(linha, key=lambda b: b.x0))
        if len(juntos) in (44, 50):
            return juntos
    return None


# ─── API publica ─────────────────────────────────────────────────────────────


def entry_from_boxes(boxes: list[Box], source_file: str) -> NfseEntry | None:
    """Monta o NfseEntry a partir das caixas. None se faltar identidade minima.

    Confianca minima (mesma regra do caminho de texto nativo): precisa ter
    chave OU (cnpj_tomador + numero).
    """
    if not boxes:
        return None

    cnpj_tomador = find_cnpj_em_secao(boxes, _SECOES_TOMADOR)
    cnpj_prestador = find_cnpj_em_secao(boxes, _SECOES_PRESTADOR)
    razao_prestador = find_razao_em_secao(boxes, _SECOES_PRESTADOR)
    razao_tomador = find_razao_em_secao(boxes, _SECOES_TOMADOR)
    numero = find_numero(boxes)
    chave = find_chave(boxes)

    # Rede: se a extracao por posicao nao achou um campo, tenta os regexes
    # lineares ja existentes sobre o texto reconstruido.
    if numero is None or cnpj_tomador is None or chave is None:
        from pdf_text_extractor import _find_chave as _lin_chave
        from pdf_text_extractor import _find_numero as _lin_numero
        from pdf_text_extractor import _find_tomador_cnpj as _lin_cnpj

        texto = linear_text(boxes)
        if numero is None:
            numero = _lin_numero(texto)
        if cnpj_tomador is None:
            cnpj_tomador = _lin_cnpj(texto)
        if chave is None:
            chave = _lin_chave(texto)

    # Um digito errado na chave elimina a nota silenciosamente (PDF com chave
    # nao cai no fallback). Cruzamos com o que lemos em separado.
    chave, _motivo = aceitar_chave_ocr(
        chave, cnpj_prestador=cnpj_prestador, numero_nf=numero
    )

    if not chave and not (cnpj_tomador and numero):
        return None

    return NfseEntry(
        cnpj_tomador=cnpj_tomador,
        numero_nf=numero,
        chave_nf=chave,
        source_file=source_file,
        method="ocr-local",
        cnpj_prestador=cnpj_prestador,
        razao_social_prestador=razao_prestador,
        razao_social_tomador=razao_tomador,
    )


def extract_local_ocr(path: str | Path) -> tuple[NfseEntry | None, str | None]:
    """Le um PDF ou imagem por OCR local. Retorna (entry, motivo_da_falha).

    Sobe o DPI e avanca de pagina enquanto nao conseguir identidade minima —
    preferimos gastar tempo a devolver a nota como ilegivel.
    """
    p = Path(path)
    nome = display_name(p.name)
    if not available():
        return None, "OCR local indisponivel (dependencias nao instaladas)"

    eh_imagem = p.suffix.lower() != ".pdf"
    ultimo_erro: str | None = None

    for dpi in dpi_ladder():
        for page in range(1 if eh_imagem else max_pages()):
            try:
                if eh_imagem:
                    import cv2
                    import numpy as np

                    data = np.fromfile(str(p), dtype=np.uint8)
                    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
                else:
                    img = render_page(p, page, dpi)
            except Exception as e:
                ultimo_erro = f"falha ao rasterizar: {type(e).__name__}: {e}"
                continue
            if img is None:
                break  # pagina inexistente — nao adianta insistir nas seguintes

            try:
                boxes = read_image(img)
            except Exception as e:
                ultimo_erro = f"falha no OCR: {type(e).__name__}: {e}"
                continue

            entry = entry_from_boxes(boxes, nome)
            if entry is not None:
                return entry, None
            if not boxes:
                ultimo_erro = "OCR local nao reconheceu texto na pagina"
            else:
                ultimo_erro = (
                    "OCR local leu a pagina mas nao encontrou chave nem CNPJ do "
                    "tomador + numero da nota"
                )
        if eh_imagem:
            break

    return None, ultimo_erro or "OCR local nao conseguiu extrair os dados"
