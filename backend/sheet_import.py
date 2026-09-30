"""Turn a collection spreadsheet into normalised import rows.

Reads Apple Numbers documents (the format the collection actually lives in) and
CSV, and hands back one dict per car — plus the thing that makes a Numbers file
worth parsing directly instead of exporting to CSV first: the row's fill colour.
Rows already imported by hand are marked green in the sheet, rows that could not
be found on the wiki are orange or red, and untouched rows have no fill. That
marking is the record of what has already been done, so it has to survive the
import; a CSV export would throw it away and the whole sheet would look new.

The column layout is read from the header row rather than hardcoded, because
Numbers merges cells: a merged "Name" header spanning two columns arrives as one
named column followed by an unnamed one, and the typed value can sit in either.
Unnamed columns therefore continue the last named one, and a field's value is the
non-empty pieces of its group joined together.

Runnable on its own, which is how the parse gets checked against the real sheet
without a server or a database:

    python -m sheet_import "myCarListExcel copy.numbers" --summary
"""

from __future__ import annotations

import csv
import io
import re
from collections import Counter
from typing import Any, Iterable, Optional

# ─── Field aliases ───────────────────────────────────────────────────────────
# Header text (lowercased, punctuation-stripped) → canonical field name. Matched
# by "starts with" so "# out of (only for)" and "more details…" still land.

FIELD_ALIASES: list[tuple[str, tuple[str, ...]]] = [
    ("name",       ("name", "car", "casting", "model name", "modelname")),
    ("color",      ("color", "colour")),
    ("body",       ("model", "body", "kind")),
    ("year",       ("year", "yr")),
    ("set_name",   ("set", "series", "segment")),
    ("set_number", ("# out of", "#out of", "number", "col #", "#")),
    ("real_rider", ("real rider", "realrider", "rubber")),
    ("details",    ("more details", "details", "notes", "note", "comment", "remarks")),
]

# Sheet/file names that say whether the cars on it are still in the packaging.
_LOOSE_WORDS = ("loose", "unboxed", "unpacked", "open", "opened", "out of box")
_CARDED_WORDS = ("packed", "carded", "boxed", "sealed", "in box", "mint on card", "moc")

# Details text that means "this one is a treasure hunt".
_TH_PATTERNS = re.compile(r"^(th|t\.h\.|treasure hunt)$|\bsuper th\b|\bsth\b|\bth\b|\btreasure hunt\b", re.I)
_STH_PATTERNS = re.compile(r"\bsuper th\b|\bsth\b|\bsuper treasure hunt\b", re.I)

# Brands that are not Hot Wheels — the wiki will never find these, so the row is
# flagged and goes straight to "add by hand" instead of burning a lookup.
_OTHER_BRANDS = ("matchbox", "majorette", "mini gt", "minigt", "not hotwheels",
                 "not hot wheels", "siku", "tomica", "welly", "maisto", "greenlight")

_DASHES = re.compile(r"^[\s\-—–_.]*$")


# ─── Small helpers ───────────────────────────────────────────────────────────

def _text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return re.sub(r"\s+", " ", str(value)).strip()


def _norm_header(value: str) -> str:
    return re.sub(r"[^a-z0-9# ]+", " ", _text(value).lower()).strip()


def _canonical_field(header: str) -> Optional[str]:
    h = _norm_header(header)
    if not h:
        return None
    for field, aliases in FIELD_ALIASES:
        for alias in aliases:
            if h == alias or h.startswith(alias + " ") or h.startswith(alias):
                return field
    return None


def _is_blank_row(values: Iterable[str]) -> bool:
    return all(not v or _DASHES.match(v) for v in values)


def classify_fill(rgb: Optional[tuple[int, int, int]]) -> str:
    """Fill colour → the meaning the sheet gives it.

    green  = already imported by hand, so don't offer it again
    amber  = tried and not found on the wiki (orange or red in the sheet)
    none   = untouched, or explicitly white — white is what Numbers leaves when a
             fill is cleared, so it means the same as no fill at all
    """
    if rgb is None:
        return "none"
    r, g, b = rgb
    if r > 235 and g > 235 and b > 235:
        return "none"
    if g > r + 15 and g > b + 15:
        return "green"
    if r > g + 15 and r > b + 15:
        return "amber"
    return "other"


def guess_carded(sheet_name: str) -> Optional[bool]:
    """True = still in its packaging, False = loose, None = the name doesn't say."""
    name = sheet_name.lower()
    if any(word in name for word in _LOOSE_WORDS):
        return False
    if any(word in name for word in _CARDED_WORDS):
        return True
    return None


def parse_year(raw: str) -> Optional[int]:
    """First plausible 4-digit year. Covers '?', '-', and '1969, 2011-14'."""
    match = re.search(r"\b(19|20)\d{2}\b", raw)
    if not match:
        return None
    year = int(match.group(0))
    return year if 1960 <= year <= 2100 else None


def parse_set_number(raw: str) -> tuple[Optional[int], Optional[int]]:
    """'3/5' → (3, 5); '#34' → (34, None); '-' or '----' → (None, None)."""
    if not raw or _DASHES.match(raw):
        return None, None
    fraction = re.search(r"(\d+)\s*/\s*(\d+)", raw)
    if fraction:
        return int(fraction.group(1)), int(fraction.group(2))
    single = re.search(r"\d+", raw)
    return (int(single.group(0)), None) if single else (None, None)


def parse_real_rider(raw: str) -> Optional[bool]:
    """The column is hand-typed, so it holds things like 'i think so' too."""
    value = raw.lower().strip()
    if not value:
        return None
    if value.startswith("y"):
        return True
    if value.startswith("n"):
        return False
    if "rubber" in value or "think" in value:
        return True
    return None


def search_query(name: str) -> str:
    """The name, cleaned up enough to hand to a wiki search.

    Year abbreviations are typed with a leading backtick or curly quote ('`69
    copo corvette'), and a few names carry a literal question mark where the
    casting was never identified.
    """
    query = re.sub(r"[`‘’\"?]", " ", name)
    query = re.sub(r"\((?:hot\s*wheels|hotwheels)\)", " ", query, flags=re.I)
    return re.sub(r"\s+", " ", query).strip()


def split_multi_car(name: str) -> list[str]:
    """Team Transport and 5-pack rows list several cars in one cell.

    Every part has to look like a car name on its own — two words or more — or
    castings whose own name contains "and" ("Hover and Out", "Cloak and Dagger")
    would be torn in half.
    """
    parts = [p.strip(" ,") for p in re.split(r"\s+and\s+|\s*,\s*", name) if p.strip(" ,")]
    if len(parts) < 2 or any(len(p.split()) < 2 for p in parts):
        return []
    return parts


# ─── Column mapping ──────────────────────────────────────────────────────────

def _find_header(matrix: list[list[str]]) -> tuple[int, dict[str, list[int]]]:
    """Locate the header row and group physical columns into logical fields.

    Returns (header row index, {field: [column indexes]}). An unnamed column
    continues the previous named one, which is how a merged header arrives.
    """
    for row_index, row in enumerate(matrix[:6]):
        groups: dict[str, list[int]] = {}
        current: Optional[str] = None
        for col_index, cell in enumerate(row):
            header = _text(cell)
            if header:
                field = _canonical_field(header)
                current = field
                if field:
                    groups.setdefault(field, []).append(col_index)
            elif current:
                groups.setdefault(current, []).append(col_index)
        if "name" in groups and len(groups) >= 2:
            return row_index, groups
    return -1, {}


def _fallback_groups(width: int) -> dict[str, list[int]]:
    """No recognisable header: treat column 0 as the name and give up on the rest."""
    return {"name": [0]} if width else {}


# ─── Row building ────────────────────────────────────────────────────────────

_JOINERS = {"name": " ", "color": ", ", "body": ", ", "details": " · "}


def _collect(values: list[str], columns: list[int], field: str) -> str:
    pieces = [values[c] for c in columns if c < len(values) and values[c]]
    pieces = [p for p in pieces if not _DASHES.match(p)]
    return _JOINERS.get(field, " ").join(dict.fromkeys(pieces))


def _build_row(
    values: list[str],
    fills: list[str],
    groups: dict[str, list[int]],
    *,
    sheet: str,
    row_index: int,
    carded: Optional[bool],
) -> Optional[dict]:
    get = lambda field: _collect(values, groups.get(field, []), field)  # noqa: E731

    name = get("name")
    if not name or _DASHES.match(name):
        return None

    details = get("details")
    haystack = f"{details} {get('body')}".lower()
    set_number, set_total = parse_set_number(get("set_number"))
    parts = split_multi_car(name)

    marker_counts = Counter(f for f in fills if f != "none")
    marker = marker_counts.most_common(1)[0][0] if marker_counts else "none"

    # A name that is mostly a question mark is a car the collection never
    # identified. Searching for it is pointless, so the row is flagged and the
    # review screen offers to enter it by hand instead.
    query = search_query(parts[0] if parts else name)
    unidentified = name.lstrip().startswith("?") or len(query.replace("(", "").replace(")", "").strip()) < 2

    return {
        "sheet": sheet,
        "row_index": row_index,          # 1-based, matches what Numbers shows
        "name": name,
        "query": query,
        "color": get("color"),
        "body": get("body"),
        "year": parse_year(get("year")),
        "year_raw": get("year"),
        "set_name": get("set_name"),
        "set_number": set_number,
        "set_total": set_total,
        "real_rider": parse_real_rider(get("real_rider")),
        "details": details,
        "carded": carded,
        "marker": marker,
        "treasure_hunt": bool(_TH_PATTERNS.search(haystack)),
        "super_treasure_hunt": bool(_STH_PATTERNS.search(haystack)),
        "other_brand": next((b for b in _OTHER_BRANDS if b in haystack), None),
        "multi_car": parts,
        "unidentified": unidentified,
    }


def _rows_from_matrix(
    matrix: list[list[str]],
    fill_matrix: list[list[str]],
    *,
    sheet: str,
    carded: Optional[bool],
) -> list[dict]:
    header_index, groups = _find_header(matrix)
    if not groups:
        groups = _fallback_groups(max((len(r) for r in matrix), default=0))
        header_index = -1
    if not groups:
        return []

    rows: list[dict] = []
    for offset, values in enumerate(matrix):
        if offset <= header_index or _is_blank_row(values):
            continue
        fills = fill_matrix[offset] if offset < len(fill_matrix) else []
        row = _build_row(
            values, fills, groups,
            sheet=sheet, row_index=offset + 1, carded=carded,
        )
        if row:
            rows.append(row)

    _mark_duplicates(rows)
    return rows


def _mark_duplicates(rows: list[dict]) -> None:
    """Flag rows that repeat name+colour+year within a sheet.

    Usually it means two of the same car, so the review screen can offer "own 2"
    on one row instead of making the same decision twice. The sibling row numbers
    travel with the flag so it can name them.
    """
    key = lambda r: (r["name"].lower(), r["color"].lower(), r["year"])  # noqa: E731
    groups: dict[tuple, list[int]] = {}
    for row in rows:
        groups.setdefault(key(row), []).append(row["row_index"])
    for row in rows:
        siblings = groups[key(row)]
        row["duplicate_count"] = len(siblings)
        row["duplicate_rows"] = siblings if len(siblings) > 1 else []


# ─── Numbers ─────────────────────────────────────────────────────────────────

def parse_numbers(data: bytes) -> list[dict]:
    """Parse a .numbers document. One sheet in, its first table is what counts."""
    # Imported lazily: a CSV import shouldn't pay for loading the Numbers reader,
    # and the module stays importable if the dependency is ever missing.
    import tempfile

    from numbers_parser import Document

    with tempfile.NamedTemporaryFile(suffix=".numbers") as handle:
        handle.write(data)
        handle.flush()
        document = Document(handle.name)
        sheets = []
        for sheet in document.sheets:
            if not sheet.tables:
                continue
            table = sheet.tables[0]
            matrix: list[list[str]] = []
            fills: list[list[str]] = []
            for row in table.rows():
                matrix.append([_text(cell.value) for cell in row])
                fills.append([classify_fill(_rgb(cell)) for cell in row])
            sheets.append((sheet.name, matrix, fills))

    rows: list[dict] = []
    for name, matrix, fills in sheets:
        rows.extend(_rows_from_matrix(matrix, fills, sheet=name, carded=guess_carded(name)))
    return rows


def _rgb(cell: Any) -> Optional[tuple[int, int, int]]:
    try:
        color = cell.style.bg_color if cell.style else None
    except Exception:
        return None
    if color is None:
        return None
    # A gradient fill comes back as a list of stops; the first one is enough.
    if isinstance(color, list):
        color = color[0] if color else None
        if color is None:
            return None
    return (color.r, color.g, color.b)


# ─── CSV ─────────────────────────────────────────────────────────────────────

def parse_csv(data: bytes, *, sheet: str) -> list[dict]:
    text = data.decode("utf-8-sig", errors="replace")
    dialect: Any
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
    except csv.Error:
        dialect = csv.excel
    matrix = [row for row in csv.reader(io.StringIO(text), dialect)]
    matrix = [[_text(cell) for cell in row] for row in matrix]
    fills = [["none"] * len(row) for row in matrix]
    return _rows_from_matrix(matrix, fills, sheet=sheet, carded=guess_carded(sheet))


# ─── Entry point ─────────────────────────────────────────────────────────────

def parse(data: bytes, filename: str) -> list[dict]:
    lower = filename.lower()
    if lower.endswith(".numbers"):
        return parse_numbers(data)
    if lower.endswith((".csv", ".tsv", ".txt")):
        stem = re.sub(r"\.[^.]+$", "", filename.rsplit("/", 1)[-1])
        return parse_csv(data, sheet=stem or "Sheet")
    raise ValueError("Unsupported file type — use a .numbers or .csv file")


def summarise(rows: list[dict]) -> list[dict]:
    """Per-sheet counts, for the screen that appears right after an upload."""
    sheets: dict[str, dict] = {}
    for row in rows:
        entry = sheets.setdefault(row["sheet"], {
            "sheet": row["sheet"], "total": 0, "green": 0, "amber": 0, "untouched": 0,
            "carded": row["carded"],
        })
        entry["total"] += 1
        if row["marker"] == "green":
            entry["green"] += 1
        elif row["marker"] == "amber":
            entry["amber"] += 1
        else:
            entry["untouched"] += 1
    return list(sheets.values())


if __name__ == "__main__":
    import argparse
    import json
    import sys

    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("path")
    cli.add_argument("--summary", action="store_true", help="counts instead of rows")
    cli.add_argument("--limit", type=int, default=0, help="only print the first N rows")
    args = cli.parse_args()

    with open(args.path, "rb") as handle:
        parsed = parse(handle.read(), args.path)

    if args.summary:
        json.dump(summarise(parsed), sys.stdout, indent=2)
    else:
        json.dump(parsed[: args.limit] if args.limit else parsed, sys.stdout, indent=2)
    print()
