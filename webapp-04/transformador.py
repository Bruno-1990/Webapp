from excel import ExcelManager
from planilha import PlanilhaSCI
from progress_weighted import Stage, WeightedProgress


class TransformadorProdutos:
    def __init__(
        self,
        caminho_sci: str,
        caminho_cliente: str | None,
        caminho_saida: str,
        incluir_confronto: bool = True,
        sheet_name: str | None = None,
    ):
        self.caminho_sci = caminho_sci
        self.caminho_cliente = caminho_cliente
        self.caminho_saida = caminho_saida
        self.incluir_confronto = incluir_confronto
        self.sheet_name = sheet_name

        self.sci = None
        self.df_cli_final = None
        self.confronto = None

    def carregar_sci(self):
        df_sci_in = ExcelManager.carregar(self.caminho_sci)
        if isinstance(df_sci_in, dict):
            if self.sheet_name:
                if self.sheet_name not in df_sci_in:
                    keys = sorted(df_sci_in.keys())
                    raise ValueError(
                        f"Aba '{self.sheet_name}' não encontrada. Abas disponíveis: {keys}"
                    )
                df_sci_in = df_sci_in[self.sheet_name]
            else:
                keys = sorted(df_sci_in.keys())
                df_sci_in = df_sci_in[keys[0]]
        self.sci = PlanilhaSCI(self.caminho_sci).processar(df_sci_in)
        return self.sci

    def carregar_cliente(self):
        if not self.incluir_confronto or not self.caminho_cliente:
            return None
        raise NotImplementedError("Confronto não suportado neste pacote headless.")

    def gerar_confronto(self):
        if not self.incluir_confronto:
            return None
        raise NotImplementedError("Confronto não suportado neste pacote headless.")

    def salvar(self, on_progress=None):
        abas = {
            "Produtos": getattr(self.sci, "raw", None),
            "Base": getattr(self.sci, "base", None),
            "Consolidado (SCI)": getattr(self.sci, "final", None),
        }
        ExcelManager.salvar(self.caminho_saida, on_progress=on_progress, **abas)

    def executar(self, progress=None):
        stages = [
            Stage("Início", 5),
            Stage("Processamento", 55),
            Stage("Configuração", 5),
            Stage("Finalização", 35),
        ]
        wp = progress if isinstance(progress, WeightedProgress) else WeightedProgress(progress, stages)

        wp.goto("Início")
        wp.set_message("Validando parâmetros…")
        wp.complete_stage()

        wp.goto("Processamento")
        wp.set_message("Carregando e transformando dados…")
        self.carregar_sci()
        wp.advance_local(40)
        if self.incluir_confronto and self.caminho_cliente:
            wp.set_message("Carregando base do Cliente…")
            self.carregar_cliente()
            wp.advance_local(75)
            wp.set_message("Gerando Confronto…")
            self.gerar_confronto()
            wp.advance_local(100)
        else:
            wp.advance_local(100)

        wp.goto("Configuração")
        wp.set_message("Ajustando metadados…")
        wp.complete_stage()

        wp.goto("Finalização")
        wp.set_message("Gravando planilhas…")
        self.salvar(on_progress=wp.excel_progress)
        wp.complete_stage()

        return self.caminho_saida
