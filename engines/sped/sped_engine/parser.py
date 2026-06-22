import re

class DefaultSpedParser:
    def parse(self, text: str, target_regs):
        data = {r: [] for r in target_regs}

        # contexto C e D
        current_num_doc_c = ""
        current_chv_nfe = ""
        current_num_doc_d = ""
        current_chv_cte = ""
        # contexto C500 e D500
        current_num_doc_c500 = ""
        current_num_doc_d500 = ""

        for line_no, raw in enumerate(text.splitlines(), start=1):
            if "|" not in raw:
                continue

            fields = raw.rstrip("").split("|")
            if len(fields) < 3:
                continue

            payload = fields[1:-1]
            reg = (payload[0] or "").upper()

            # === BLOCO C ===
            if reg == "C100":
                current_num_doc_c = fields[8] if len(fields) > 8 else ""
                current_chv_nfe = fields[9] if len(fields) > 9 else ""
                parts = payload[:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            if reg in ("C170", "C190"):
                parts = [payload[0], current_num_doc_c, current_chv_nfe] + payload[1:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            # === BLOCO C500 / C590 ===
            if reg == "C500":
                current_num_doc_c500 = fields[10] if len(fields) > 10 else ""
                parts = payload[:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            if reg == "C590":
                parts = [payload[0], current_num_doc_c500] + payload[1:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            # === BLOCO D ===
            if reg == "D100":
                current_num_doc_d = fields[9] if len(fields) > 9 else ""
                current_chv_cte = fields[10] if len(fields) > 10 else ""
                parts = payload[:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            if reg == "D190":
                parts = [payload[0], current_num_doc_d, current_chv_cte] + payload[1:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            # === BLOCO D500 / D590 ===
            if reg == "D500":
                current_num_doc_d500 = fields[9] if len(fields) > 9 else ""
                parts = payload[:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            if reg == "D590":
                parts = [payload[0], current_num_doc_d500] + payload[1:]
                if reg in data:
                    data[reg].append((line_no, parts))
                continue

            # genérico
            if reg in data:
                parts = payload[:]
                data[reg].append((line_no, parts))

        return data


    def extract_razao_cnpj(self, text: str):
        """
        Método antigo: pega Razão Social e CNPJ do |0000|
        """
        razao, cnpj = "RAZAO_DESCONHECIDA", "CNPJ_DESCONHECIDO"
        for raw in text.splitlines():
            if raw.startswith("|0000|"):
                parts = raw.split("|")
                if len(parts) >= 8:
                    razao = (parts[6] or "").strip() or razao
                    cnpj_raw = (parts[7] or "").strip()
                    if cnpj_raw:
                        cnpj = re.sub(r"\D", "", cnpj_raw) or cnpj
                break
        return razao, cnpj
