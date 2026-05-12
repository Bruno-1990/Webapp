"""Valida CPF/CNPJ e parseia valores BR. Cada validador levanta ValidationError."""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation


class ValidationError(ValueError):
    pass


_DIGITS = re.compile(r"\D")


def _only_digits(s: str) -> str:
    return _DIGITS.sub("", s or "")


def _cpf_check(cpf: str) -> bool:
    if len(cpf) != 11 or cpf == cpf[0] * 11:
        return False
    for i in (9, 10):
        s = sum(int(cpf[j]) * ((i + 1) - j) for j in range(i))
        d = (s * 10) % 11
        if d == 10:
            d = 0
        if d != int(cpf[i]):
            return False
    return True


def _cnpj_check(cnpj: str) -> bool:
    if len(cnpj) != 14 or cnpj == cnpj[0] * 14:
        return False
    weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    weights2 = [6] + weights1
    for digits, weights in ((cnpj[:12], weights1), (cnpj[:13], weights2)):
        s = sum(int(d) * w for d, w in zip(digits, weights))
        v = s % 11
        v = 0 if v < 2 else 11 - v
        if v != int(cnpj[len(digits)]):
            return False
    return True


def validate_cpf_cnpj(value: str) -> str:
    digits = _only_digits(value)
    if len(digits) == 11:
        if not _cpf_check(digits):
            raise ValidationError(f"CPF inválido: {digits}")
        return digits
    if len(digits) == 14:
        if not _cnpj_check(digits):
            raise ValidationError(f"CNPJ inválido: {digits}")
        return digits
    raise ValidationError(
        f"CNPJ/CPF com tamanho inesperado ({len(digits)} dígitos): {digits!r}"
    )


def parse_valor_br(s: str) -> Decimal:
    if s is None:
        raise ValidationError("valor ausente")
    raw = str(s).strip()
    if not raw:
        raise ValidationError("valor vazio")
    if not re.fullmatch(r"\d{1,3}(\.\d{3})*,\d{2}|\d+,\d{2}", raw):
        raise ValidationError(f"valor fora do padrão BR: {raw!r}")
    try:
        return Decimal(raw.replace(".", "").replace(",", "."))
    except InvalidOperation as e:
        raise ValidationError(f"valor não numérico: {raw!r}") from e


def validate_valor_principal(s: str) -> Decimal:
    v = parse_valor_br(s)
    if v <= 0:
        raise ValidationError(f"valor principal deve ser > 0 (recebido {v})")
    return v
