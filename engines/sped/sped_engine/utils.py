import re
def sanitize_filename(s: str) -> str:
    s = re.sub(r"[^\w\s.-]", "_", s)
    s = re.sub(r"\s+", "_", s).strip("_")
    return s[:150]