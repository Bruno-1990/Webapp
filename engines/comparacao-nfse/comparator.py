"""Compara duas listas de NfseEntry e retorna match/so_pdf/so_xml.

Estrategia em DUAS PASSAGENS (regra do negocio):

  Passagem 1 — chave (estrita):
    Para cada PDF que tem `chave_nf`, procura UM XML com a MESMA chave.
    Match consome o XML (cada XML so casa uma vez). PDFs com chave que
    nao acharem XML correspondente nao caem em fallback — ficam em
    `so_pdf` mesmo que tenham cnpj+numero.

  Passagem 2 — cnpj+numero (so PDFs sem chave):
    Para cada PDF que NAO tem chave (OCR de imagens, scans com leitura
    parcial), tenta casar com os XMLs RESTANTES (nao consumidos na
    passagem 1) por (cnpj_tomador, numero_nf).

Detecta tambem duplicados de PDF: grupos de >=2 entries que compartilham
a mesma chave_nf OU o mesmo (cnpj_tomador, numero_nf). Util para
sinalizar ao usuario que ele anexou o mesmo documento mais de uma vez.
A logica de match nao muda — apenas o primeiro de cada grupo casa.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from xml_parser import NfseEntry


@dataclass(frozen=True)
class DuplicateGroup:
    """Grupo de NfseEntry com identidade comum.

    `chave_nf` definido => grupo formado por chave; `cnpj_tomador` +
    `numero_nf` definidos => grupo formado por (cnpj, numero). Nunca os dois
    ao mesmo tempo (priorizamos chave quando disponivel).
    """
    chave_nf: str | None
    cnpj_tomador: str | None
    numero_nf: str | None
    entries: tuple[NfseEntry, ...]

    def to_dict(self) -> dict:
        return {
            "chaveNf": self.chave_nf,
            "cnpjTomador": self.cnpj_tomador,
            "numeroNf": self.numero_nf,
            "entries": [e.to_dict() for e in self.entries],
        }


@dataclass(frozen=True)
class Resultado:
    so_pdf: list[NfseEntry]
    so_xml: list[NfseEntry]
    matched_count: int
    duplicados_pdf: list[DuplicateGroup] = field(default_factory=list)


def _detectar_duplicados_pdf(pdfs: list[NfseEntry]) -> list[DuplicateGroup]:
    """Identifica grupos de PDFs com identidade duplicada.

    Prioridade: chave_nf (mais forte) sobre (cnpj_tomador, numero_nf).
    Cada entry aparece em no maximo um grupo — entries ja agrupadas por
    chave nao entram no agrupamento por (cnpj, numero).
    """
    por_chave: dict[str, list[NfseEntry]] = {}
    for p in pdfs:
        if p.chave_nf:
            por_chave.setdefault(p.chave_nf, []).append(p)

    ja_agrupadas: set[int] = set()
    grupos: list[DuplicateGroup] = []
    for chave, entries in por_chave.items():
        if len(entries) >= 2:
            grupos.append(DuplicateGroup(
                chave_nf=chave,
                cnpj_tomador=None,
                numero_nf=None,
                entries=tuple(entries),
            ))
            for e in entries:
                ja_agrupadas.add(id(e))

    por_cnpj_num: dict[tuple[str, str], list[NfseEntry]] = {}
    for p in pdfs:
        if id(p) in ja_agrupadas:
            continue
        if p.cnpj_tomador and p.numero_nf:
            por_cnpj_num.setdefault((p.cnpj_tomador, p.numero_nf), []).append(p)

    for (cnpj, numero), entries in por_cnpj_num.items():
        if len(entries) >= 2:
            grupos.append(DuplicateGroup(
                chave_nf=None,
                cnpj_tomador=cnpj,
                numero_nf=numero,
                entries=tuple(entries),
            ))

    return grupos


def comparar(pdfs: list[NfseEntry], xmls: list[NfseEntry]) -> Resultado:
    matched_pdf: set[int] = set()
    matched_xml: set[int] = set()

    # Indices reversos. Se um XML aparece duplicado, mantemos a primeira ocorrencia
    # — segundo match pelo mesmo XML nao acontece pois o set guarda o indice.
    xml_por_chave: dict[str, list[int]] = {}
    xml_por_cnpj_num: dict[tuple[str, str], list[int]] = {}
    for i, x in enumerate(xmls):
        if x.chave_nf:
            xml_por_chave.setdefault(x.chave_nf, []).append(i)
        if x.cnpj_tomador and x.numero_nf:
            xml_por_cnpj_num.setdefault(
                (x.cnpj_tomador, x.numero_nf), []
            ).append(i)

    def _claim(idx_list: list[int]) -> int | None:
        for j in idx_list:
            if j not in matched_xml:
                matched_xml.add(j)
                return j
        return None

    # Passagem 1 — PDFs com chave
    for i, p in enumerate(pdfs):
        if not p.chave_nf:
            continue
        candidatos = xml_por_chave.get(p.chave_nf)
        if candidatos and _claim(candidatos) is not None:
            matched_pdf.add(i)

    # Passagem 2 — PDFs SEM chave: tentam (cnpj, numero) em XMLs nao consumidos
    for i, p in enumerate(pdfs):
        if i in matched_pdf:
            continue
        if p.chave_nf:
            # Regra do negocio: PDF com chave nao cai em fallback
            continue
        if not (p.cnpj_tomador and p.numero_nf):
            continue
        candidatos = xml_por_cnpj_num.get((p.cnpj_tomador, p.numero_nf))
        if candidatos and _claim(candidatos) is not None:
            matched_pdf.add(i)

    so_pdf = [p for i, p in enumerate(pdfs) if i not in matched_pdf]
    so_xml = [x for j, x in enumerate(xmls) if j not in matched_xml]

    return Resultado(
        so_pdf=so_pdf,
        so_xml=so_xml,
        matched_count=len(matched_pdf),
        duplicados_pdf=_detectar_duplicados_pdf(pdfs),
    )
