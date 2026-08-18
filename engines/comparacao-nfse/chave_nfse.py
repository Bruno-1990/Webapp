"""Validacao estrutural da chave de acesso da NFS-e.

Motivacao: um unico digito lido errado pelo OCR produz uma chave que "parece"
valida (50 digitos) mas nunca casa com XML nenhum. Pior: pela regra do negocio
(ver comparator.py), um PDF COM chave nao cai no fallback de cnpj+numero — ou
seja, uma chave errada elimina silenciosamente uma nota que casaria.

A chave nacional (50 digitos) carrega campos que tambem lemos em separado no
documento, entao da para cruzar:

  32051011234585211000155260000000031226030000654608
  ^^^^^^^                                              IBGE do municipio
         ^^^^^^^^^^^^^^^^                              CNPJ do prestador
                          ^^^^^^^^^^                   numero da nota

Em vez de fixar posicoes (que variam entre layout nacional e NFe 44 digitos),
usamos CONTENCAO de substring — mais tolerante e suficiente para o objetivo,
que e detectar erro de leitura, nao validar juridicamente o documento.

Filosofia: so acusamos contradicao quando ha evidencia POSITIVA de conflito.
Na duvida, a chave passa — preferimos deixar passar uma chave ruim a descartar
uma boa (descartar tira a nota do match por chave).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

_ONLY_DIGITS = re.compile(r"^\d+$")

# Faixa de codigos IBGE de municipio: 7 digitos comecando em 1..5 (regioes
# Norte a Sul). 0xxxxxx e 6..9xxxxxx nao existem.
_IBGE_MIN = 1_000_000
_IBGE_MAX = 5_999_999

VALID_LENGTHS = (44, 50)


@dataclass(frozen=True)
class ChaveCheck:
    """Resultado do cruzamento. `suspeita` e o unico campo que muda decisao."""

    valida_estrutura: bool
    corroboracoes: tuple[str, ...]
    contradicoes: tuple[str, ...]

    @property
    def suspeita(self) -> bool:
        """True quando a chave nao merece confianca.

        O CNPJ do prestador tem peso de veto: sao 14 digitos: acertar por acaso
        e implausivel, e NAO encontra-los na chave e evidencia forte de leitura
        errada. Ja o numero da nota tem 3-5 digitos e casa por coincidencia com
        facilidade — visto na pratica, uma chave com digitos trocados que ainda
        assim continha "7095" e passou como boa, custando um match.
        """
        if not self.valida_estrutura:
            return True
        if "cnpj_prestador" in self.contradicoes:
            return True
        return bool(self.contradicoes) and not self.corroboracoes


def estrutura_ok(chave: str | None) -> bool:
    """Checagem barata: comprimento certo, so digitos, nao degenerada."""
    if not chave or not _ONLY_DIGITS.match(chave):
        return False
    if len(chave) not in VALID_LENGTHS:
        return False
    # Sequencia de um digito so (0000... / 9999...) e lixo de OCR, nao chave.
    if len(set(chave)) == 1:
        return False
    if len(chave) == 50:
        ibge = int(chave[:7])
        if not (_IBGE_MIN <= ibge <= _IBGE_MAX):
            return False
    return True


def cruzar(
    chave: str | None,
    *,
    cnpj_prestador: str | None = None,
    numero_nf: str | None = None,
) -> ChaveCheck:
    """Cruza a chave com campos lidos separadamente do mesmo documento.

    Cada fato conhecido (CNPJ do prestador, numero da nota) vira uma
    corroboracao se aparecer dentro da chave, ou uma contradicao se nao
    aparecer. Fatos ausentes simplesmente nao contam.
    """
    if not estrutura_ok(chave):
        return ChaveCheck(False, (), ())

    assert chave is not None
    corrobora: list[str] = []
    contradiz: list[str] = []

    if cnpj_prestador and len(cnpj_prestador) == 14:
        if cnpj_prestador in chave:
            corrobora.append("cnpj_prestador")
        else:
            contradiz.append("cnpj_prestador")

    if numero_nf and numero_nf.isdigit():
        # O numero aparece zero-padded na chave; testamos algumas larguras
        # usuais em vez de fixar o layout.
        alvos = {numero_nf} | {numero_nf.zfill(w) for w in (6, 8, 9, 10, 15)}
        if any(a in chave for a in alvos):
            corrobora.append("numero_nf")
        else:
            contradiz.append("numero_nf")

    return ChaveCheck(True, tuple(corrobora), tuple(contradiz))


def aceitar_chave_ocr(
    chave: str | None,
    *,
    cnpj_prestador: str | None = None,
    numero_nf: str | None = None,
) -> tuple[str | None, str | None]:
    """Decide se uma chave vinda de OCR pode ser usada.

    Retorna `(chave_aceita, motivo_da_rejeicao)`. Rejeitar significa devolver
    None na chave — o entry cai no fallback de (cnpj, numero), que e
    exatamente o comportamento desejado quando desconfiamos da leitura.

    So aplicamos a rejeicao em chaves de OCR: chave vinda de texto nativo do
    PDF nao tem risco de erro de digito.
    """
    if chave is None:
        return None, None
    check = cruzar(chave, cnpj_prestador=cnpj_prestador, numero_nf=numero_nf)
    if not check.valida_estrutura:
        return None, "chave com estrutura invalida"
    if check.suspeita:
        return None, f"chave nao confere com {', '.join(check.contradicoes)}"
    return chave, None
