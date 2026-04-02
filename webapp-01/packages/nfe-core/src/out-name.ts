/** Nome do XLSX a partir do primeiro arquivo (mesma regra do Python). */
export function getOutName(firstPathOrName: string): string {
  const base = firstPathOrName.replace(/^.*[/\\]/, "").replace(/\.[^.]+$/, "");
  const m = base.match(/(\d{44})/);
  if (m) return `NFe_Itens_${m[1]!.slice(-8)}.xlsx`;
  return "NFe_Itens.xlsx";
}
