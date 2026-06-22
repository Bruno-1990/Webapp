from pathlib import Path
class SpedFileReader:
    def read(self, path: Path) -> str:
        for enc in ("utf-8", "cp1252", "latin-1"):
            try:
                return path.read_text(encoding=enc)
            except UnicodeDecodeError:
                continue
            except Exception as exc:
                raise RuntimeError(f"Falha ao ler o arquivo: {path}") from exc
        raise RuntimeError("Falha ao ler o arquivo.")