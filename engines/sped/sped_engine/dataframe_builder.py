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
            return pd.DataFrame(columns=["_LINHA"] + self.headers[rec]), 0, 0

        adjusted = []
        mism, max_extra = 0, 0

        for item in rows:
            line_no, r = item
            r = list(r)
            if r and str(r[0]).upper() != rec:
                mism += 1
            if len(r) < base:
                r += [""] * (base - len(r))
            row_out = [line_no] + r
            adjusted.append(row_out)
            ex = len(r) - base
            if ex > max_extra:
                max_extra = ex

        extra_cols = [f"EXTRA_{i:02d}" for i in range(1, max_extra + 1)]
        cols = ["_LINHA"] + self.headers[rec] + extra_cols
        df = pd.DataFrame(adjusted, columns=cols)
        return df, max_extra, mism

    def _build_generic(self, rec: str, rows):
        if not rows:
            return pd.DataFrame(columns=["_LINHA", "COL_01"]), 0, 0

        max_payload = max(len(r) for _ln, r in rows)
        cap = min(max_payload, MAX_GENERIC_COLS)
        truncated = max_payload > cap

        adjusted = []
        mism = 0

        for item in rows:
            line_no, r = item
            r = list(r)
            if r and str(r[0]).upper() != rec:
                mism += 1
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
            max_extra = 1
        cols = col_names + extra_cols
        df = pd.DataFrame(adjusted, columns=cols)
        return df, max_extra, mism
