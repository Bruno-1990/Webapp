import pandas as pd

MAX_GENERIC_COLS = 512


class DefaultDataFrameBuilder:
    def __init__(self, headers: dict):
        self.headers = headers

    def build(self, rec: str, rows):
        if rec not in self.headers:
            return self._build_generic(rec, rows)
        base = len(self.headers[rec])
        if not rows:
            return pd.DataFrame(columns=["_LINHA"] + self.headers[rec])

        adjusted = []
        max_extra = 0

        for item in rows:
            line_no, r = item
            r = list(r)
            if len(r) < base:
                r += [""] * (base - len(r))
            row_out = [line_no] + r
            adjusted.append(row_out)
            ex = len(r) - base
            if ex > max_extra:
                max_extra = ex

        extra_cols = [f"EXTRA_{i:02d}" for i in range(1, max_extra + 1)]
        cols = ["_LINHA"] + self.headers[rec] + extra_cols
        return pd.DataFrame(adjusted, columns=cols)

    def _build_generic(self, rec: str, rows):
        if not rows:
            return pd.DataFrame(columns=["_LINHA", "COL_01"])

        max_payload = max(len(r) for _ln, r in rows)
        cap = min(max_payload, MAX_GENERIC_COLS)
        truncated = max_payload > cap

        adjusted = []

        for item in rows:
            line_no, r = item
            r = list(r)
            rest = r[cap:] if len(r) > cap else []
            r = r[:cap] if len(r) > cap else r[:]
            if len(r) < cap:
                r += [""] * (cap - len(r))
            row_out = [line_no] + r + rest
            adjusted.append(row_out)

        col_names = ["_LINHA"] + [f"COL_{i:02d}" for i in range(1, cap + 1)]
        max_extra = max_payload - cap
        extra_cols = [f"EXTRA_{i:02d}" for i in range(1, max_extra + 1)] if max_extra > 0 else []
        if truncated and max_extra == 0:
            extra_cols = ["EXTRA_NOTA"]
            for i, row in enumerate(adjusted):
                adjusted[i] = row + ["Colunas truncadas a %d" % MAX_GENERIC_COLS]
        cols = col_names + extra_cols
        return pd.DataFrame(adjusted, columns=cols)
