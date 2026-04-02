import { describe, expect, it } from "vitest";
import { emptyRow, type NfeRow } from "./cols.js";
import {
  buildNfeExportFileName,
  formatLocalDate,
  pickDominantEmit,
  sanitizeWindowsFileBaseName,
} from "./export-file-name.js";

describe("sanitizeWindowsFileBaseName", () => {
  it("remove caracteres proibidos", () => {
    expect(sanitizeWindowsFileBaseName('ACME <>:"|?*')).toBe("ACME");
  });

  it("preserva acentos", () => {
    expect(sanitizeWindowsFileBaseName("Padaria José")).toBe("Padaria José");
  });
});

describe("buildNfeExportFileName", () => {
  it("usa razão social e data", () => {
    const d = new Date(2025, 2, 26);
    expect(buildNfeExportFileName("Empresa Teste LTDA", undefined, d)).toBe(
      "NFE_EMPRESA_TESTE_LTDA_2025-03-26.xlsx"
    );
  });

  it("fallback CNPJ sem nome", () => {
    const d = new Date(2025, 0, 5);
    expect(buildNfeExportFileName(undefined, "12.345.678/0001-99", d)).toBe(
      "NFE_CNPJ_12345678000199_2025-01-05.xlsx"
    );
  });

  it("fallback genérico", () => {
    const d = new Date(2024, 11, 31);
    expect(buildNfeExportFileName(undefined, undefined, d)).toBe("NFE_Itens_2024-12-31.xlsx");
  });
});

describe("pickDominantEmit", () => {
  it("escolhe emitente mais frequente", () => {
    const mk = (nome: string): NfeRow => {
      const r = emptyRow();
      r.emit_xNome = nome;
      r.emit_CNPJ = "1";
      return r;
    };
    const rows = [mk("A"), mk("B"), mk("A"), mk("A")];
    expect(pickDominantEmit(rows)).toEqual({ emitXNome: "A", emitCnpj: "1" });
  });
});

describe("formatLocalDate", () => {
  it("usa fuso local", () => {
    expect(formatLocalDate(new Date(2026, 0, 2))).toBe("2026-01-02");
  });
});
