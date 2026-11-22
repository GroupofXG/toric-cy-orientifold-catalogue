"""Stream full matching eigenfamily records as JSON Lines from the public rank ZIPs."""
import argparse
from contextlib import ExitStack
from fractions import Fraction
from glob import glob
import json
from pathlib import Path
import re
import shutil
import sys
from tempfile import SpooledTemporaryFile
from urllib.parse import parse_qs, urlsplit
from zipfile import BadZipFile, ZipFile


PLANE_BITS = {"O3": 1, "O5": 2, "O7": 4, "O9": 8, None: 16}
ACTION_KINDS = {"reflection": ("R", "REF"), "divisor_exchange": ("I", "NID")}
MAX_SAFE_INTEGER = 2**53 - 1
CATEGORIES = {"rank": tuple("1234567"), "kind": ("NID", "REF"),
              "smooth": ("smooth", "singular", "null"), "parity": ("1", "-1"),
              "omega": ("1", "-1"), "finite": ("0", "1"),
              "fixed": ("listed", "empty", "unavailable")}


def fixed_fields(loci):
    if loci is None:
        return 0, "unavailable", None
    if not loci:
        return 0, "empty", 0
    mask, points = 0, 0
    for locus in loci:
        plane = locus["type"]
        mask |= PLANE_BITS[plane]
        if plane is None:
            points = None
        elif plane == "O3" and points is not None:
            n = locus.get("point_count")
            points = None if n is None else points + n
    return mask, "listed", points


def parse_limit(key, value):
    if key == "d3":
        if not re.fullmatch(r"[+-]?[0-9]+(?:/[0-9]+|\.[0-9]+)?", value) or len(value) > 32:
            raise ValueError("D3 bounds must be integers or exact quarter units, such as 49/4")
        try:
            scaled = 4 * Fraction(value)
        except ZeroDivisionError:
            raise ValueError("D3 bound has a zero denominator") from None
        if scaled.denominator != 1:
            raise ValueError("D3 bounds must be multiples of 1/4")
        number = scaled.numerator
    else:
        if not re.fullmatch(r"[+-]?[0-9]+", value):
            raise ValueError(f"{key} bounds must be integers")
        number = int(value)
        if key == "o3" and number < 0:
            raise ValueError("O3 point-count bounds must be nonnegative")
    if abs(number) > MAX_SAFE_INTEGER:
        raise ValueError(f"{key} bound exceeds the supported integer range")
    return number


def bounds(key, text):
    parts = [p.strip() for p in text.split("..")]
    if len(parts) == 1:
        value = parse_limit(key, parts[0])
        return value, value
    if len(parts) != 2 or not any(parts):
        raise ValueError(f"Expected a value or range for {key}, such as 12.. or 3..5")
    lo, hi = (parse_limit(key, x) if x else None for x in parts)
    if lo is not None and hi is not None and lo > hi:
        raise ValueError(f"Lower {key} bound exceeds upper bound")
    return lo, hi


def url_filters(url):
    params = {k: values[0] for k, values in parse_qs(urlsplit(url).query, keep_blank_values=True).items()}
    if "search" not in params:
        raise ValueError("Copy a property-search URL containing ?search=1")
    filters = {}
    for key, choices in CATEGORIES.items():
        text = params.get(key)
        if not text:
            continue
        if text not in choices:
            raise ValueError(f"Unknown {key} value: {text}")
        if key in ("rank", "parity", "omega", "finite"):
            filters[key] = int(text)
        else:
            filters[key] = None if text == "null" else text
    for key in ("h21", "h11minus", "h21minus"):
        text = params.get(key)
        if text:
            if not re.fullmatch(r"[0-9]+", text) or int(text) > MAX_SAFE_INTEGER:
                raise ValueError(f"{key} must be a nonnegative catalogue integer")
            filters[key] = int(text)
    for key in ("euler", "o3", "d3"):
        if params.get(key):
            filters[key] = bounds(key, params[key])
    mask = 0
    for plane in filter(None, params.get("planes", "").split(",")):
        if plane not in PLANE_BITS:
            raise ValueError(f"Unknown O-plane type: {plane}")
        mask |= PLANE_BITS[plane]
    if mask:
        filters["planes"] = mask
    return filters


def eligible_actions(archive, prefix, filters):
    if not ({"h21", "finite", "kind"} & filters.keys()):
        return None
    eligible_polys = None
    if "h21" in filters or "finite" in filters:
        with archive.open(prefix + "/polytopes.jsonl") as data:
            eligible_polys = {p["polytope_id"] for p in map(json.loads, data)
                              if ("h21" not in filters or p["h21"] == filters["h21"])
                              and ("finite" not in filters or bool(p["finite_actions"]) == filters["finite"])}
    with archive.open(prefix + "/involutions.jsonl") as data:
        return {a["involution_id"] for a in map(json.loads, data)
                if (eligible_polys is None or a["polytope_id"] in eligible_polys)
                and ("kind" not in filters or ACTION_KINDS[a["type"]][1] == filters["kind"])}


def within(value, interval):
    lo, hi = interval
    return (type(value) is int and abs(value) <= MAX_SAFE_INTEGER
            and (lo is None or lo <= value) and (hi is None or value <= hi))


def matches(row, filters, actions):
    if actions is not None and row["involution_id"] not in actions:
        return False
    for key, field in (("id", "orientifold_id"), ("parity", "polynomial_parity"),
                       ("omega", "omega_parity"), ("smooth", "smoothness")):
        if key in filters and row[field] != filters[key]:
            return False
    for key, field in (("h11minus", "h11_minus"), ("h21minus", "h21_minus")):
        if key in filters and (row["hodge_splitting"] or {}).get(field) != filters[key]:
            return False
    if "euler" in filters and not within(row["euler_fixed"], filters["euler"]):
        return False
    if not ({"o3", "d3", "fixed", "planes"} & filters.keys()):
        return True
    mask, state, points = fixed_fields(row["fixed_loci"])
    planes = filters.get("planes", 0)
    if mask & planes != planes or ("fixed" in filters and state != filters["fixed"]):
        return False
    if "o3" in filters and not within(points, filters["o3"]):
        return False
    if "d3" in filters:
        # Only the local D7-stack configuration on a smooth O3/O7 eigenfamily.
        return (row["smoothness"] == "smooth" and row["omega_parity"] == -1
                and state == "listed" and mask != 0 and mask & ~5 == 0
                and within(row["euler_fixed"], filters["d3"]))
    return True


def scan(archive, prefix, filters, count_only):
    actions = eligible_actions(archive, prefix, filters)
    count = 0
    with archive.open(prefix + "/orientifolds.jsonl") as data:
        for line in data:
            if filters and not matches(json.loads(line), filters, actions):
                continue
            count += 1
            if not count_only:
                sys.stdout.buffer.write(line)
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", nargs="+", help="Rank ZIP files or rank-seven archive parts; wildcards are accepted")
    parser.add_argument("--query-url", help="Apply all property filters from a search link, across every results page")
    parser.add_argument("--id", help="exact orientifold_id")
    parser.add_argument("--kind", choices=("NID", "REF"))
    parser.add_argument("--omega", type=int, choices=(-1, 1))
    parser.add_argument("--smoothness", choices=("smooth", "singular", "null"))
    parser.add_argument("--plane", choices=("O3", "O5", "O7", "O9"),
                        help="at least one listed fixed locus of this type")
    parser.add_argument("--euler", type=int, help="Euler characteristic of the whole fixed set")
    parser.add_argument("--count", action="store_true", help="print the number of matching rows")
    args = parser.parse_args()
    flags = {"kind": args.kind, "omega": args.omega, "smooth": args.smoothness,
             "planes": PLANE_BITS[args.plane] if args.plane else None,
             "euler": (args.euler, args.euler) if args.euler is not None else None}
    filters = {key: val for key, val in flags.items() if val is not None}
    if args.query_url and filters:
        parser.error("Use --query-url or the individual property flags for a query")
    if args.query_url:
        try:
            filters = url_filters(args.query_url)
        except ValueError as exc:
            parser.error(str(exc))
    elif args.smoothness == "null":
        filters["smooth"] = None
    if args.id:
        filters["id"] = args.id
    rank_filter = filters.pop("rank", None)
    count = 0
    with ExitStack() as stack:
        archives = []
        whole_ranks = set()
        seen_batches = set()
        paths = []
        for pattern in args.archive:
            expanded = [pattern] if Path(pattern).is_file() else sorted(glob(pattern))
            if not expanded:
                parser.error(f"No input archive matches {pattern}")
            paths.extend(expanded)
        for path in paths:
            try:
                archive = stack.enter_context(ZipFile(path))
            except (BadZipFile, OSError) as exc:
                parser.error(f"{path}: {exc}")
            names = archive.namelist()
            batches = [n for n in names if re.fullmatch(r"batches/h7_b[0-9]{5}\.zip",n)]
            members = [n for n in names if re.fullmatch(r"h11=[0-9]+/orientifolds\.jsonl", n)]
            if batches:
                batch_names = set(batches)
                if members or 7 in whole_ranks:
                    parser.error(f"{path}: overlapping rank-seven inputs")
                if len(batches) != len(batch_names) or seen_batches.intersection(batch_names):
                    parser.error(f"{path}: duplicate rank-seven batch")
                if any(n.startswith("batches/") and not n.endswith("/") and n not in batch_names for n in names):
                    parser.error(f"{path}: unexpected member in batches/")
                seen_batches.update(batches)
                prefix,rank = "h11=7",7
            elif len(members) == 1:
                prefix, _ = members[0].split("/")
                rank = int(prefix.split("=")[1])
                if rank in whole_ranks or rank == 7 and seen_batches:
                    parser.error(f"Overlapping inputs for h11={rank}")
                whole_ranks.add(rank)
            else:
                parser.error(f"{path}: expected one rank-level orientifolds.jsonl or rank-seven batches")
            if rank_filter is not None and rank_filter != rank:
                parser.error(f"The search selects h11={rank_filter}, but {path} contains h11={rank}")
            archives.append((archive, prefix, batches))
        for archive, prefix, batches in archives:
            if not batches:
                count += scan(archive, prefix, filters, args.count)
                continue
            for batch in batches:
                with archive.open(batch) as src, SpooledTemporaryFile(max_size=8*1024*1024) as temp:
                    shutil.copyfileobj(src, temp, 1024*1024)
                    temp.seek(0)
                    with ZipFile(temp) as inner:
                        if inner.namelist().count(prefix+"/orientifolds.jsonl") != 1:
                            parser.error(f"{batch}: missing or duplicated family table")
                        count += scan(inner, prefix, filters, args.count)
    if args.count:
        print(count)


if __name__ == "__main__":
    main()
