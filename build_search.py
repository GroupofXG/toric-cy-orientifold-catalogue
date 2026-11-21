"""Build a static faceted index from the versioned public catalogue batches."""
import argparse
from array import array
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
from contextlib import ExitStack
import gzip
import json
from pathlib import Path
import sys
import tempfile
from zipfile import ZipFile


FIELDS = ["h21", "finite", "kind", "poly_parity", "omega", "smooth", "planes",
          "fixed_state", "euler", "o3", "h11_minus", "h21_minus", "count", "start"]
PLANE_BITS = {"O3": 1, "O5": 2, "O7": 4, "O9": 8, None: 16}
ACTION_KINDS = {"reflection": ("R", "REF"), "divisor_exchange": ("I", "NID")}
PAGE_ROWS = 32768
PART_BATCHES = 64


def tri_code(triangulation):
    suffix = triangulation.rsplit("_", 1)[1]
    if suffix.startswith("TX"):
        return int(suffix[2:]) * 2 + 1
    if suffix.startswith("T"):
        return int(suffix[1:]) * 2
    raise ValueError(f"Unrecognised triangulation ID: {triangulation}")


def rows(archive, rank, name):
    with archive.open(f"h11={rank}/{name}.jsonl") as stream:
        yield from map(json.loads, stream)


def measure(part):
    """Use this edition's actual ID ranges when packing the record links."""
    rank, paths = part
    max_tri = max_action = 0
    tri_count = action_count = 0
    for path in paths:
        with ZipFile(path) as archive:
            for row in rows(archive, rank, "triangulations"):
                max_tri = max(max_tri, tri_code(row["triangulation_id"]))
                tri_count += 1
            for row in rows(archive, rank, "involutions"):
                suffix = row["involution_id"].rsplit("_", 1)[1]
                max_action = max(max_action, int(suffix[1:]))
                action_count += 1
    return max_tri, max_action, tri_count, action_count


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


def index_part(job):
    rank, paths, polys, tri_stride, action_stride, work_file = job
    groups = defaultdict(lambda: array("d"))
    for path in paths:
        with ZipFile(path) as archive:
            properties = {}
            for poly in rows(archive, rank, "polytopes"):
                suffix = poly["polytope_id"].split("_", 1)[1]
                if poly["polytope_id"] != f"P{rank}_{suffix}" or poly["h11"] != rank:
                    raise ValueError(f"Wrong rank for polytope: {poly['polytope_id']}")
                properties[poly["polytope_id"]] = (
                    polys[suffix], poly["h21"], int(bool(poly["finite_actions"])))
            tris = {}
            for tri in rows(archive, rank, "triangulations"):
                poly_id = tri["polytope_id"]
                slot, h21, finite = properties[poly_id]
                tid = tri["triangulation_id"]
                code = tri_code(tid)
                label = "TX" if code % 2 else "T"
                if not 0 <= code < tri_stride or tid != f"{poly_id}_{label}{code // 2}":
                    raise ValueError(f"Cannot reconstruct triangulation ID: {tid}")
                base = (slot * tri_stride + code) * action_stride
                tris[tid] = (poly_id, h21, finite, base)
            actions = {}
            for action in rows(archive, rank, "involutions"):
                aid = action["involution_id"]
                suffix = aid.rsplit("_", 1)[1]
                prefix, kind = ACTION_KINDS[action["type"]]
                number = int(suffix[1:])
                if not 0 <= number < action_stride or aid != f"{action['polytope_id']}_{prefix}{number}":
                    raise ValueError(f"Inconsistent action ID: {aid}")
                actions[aid] = (action["polytope_id"], kind, number, suffix)
            for row in rows(archive, rank, "orientifolds"):
                tid = row["triangulation_id"]
                poly, h21, finite, base = tris[tid]
                action_poly, kind, number, suffix = actions[row["involution_id"]]
                parity = row["polynomial_parity"]
                if parity not in (-1, 1) or action_poly != poly:
                    raise ValueError(f"Inconsistent foreign key or parity: {row['orientifold_id']}")
                sector = "Pplus" if parity == 1 else "Pminus"
                if row["orientifold_id"] != f"{tid}_{suffix}_{sector}":
                    raise ValueError(f"Cannot reconstruct link: {row['orientifold_id']}")
                mask, state, points = fixed_fields(row["fixed_loci"])
                split = row["hodge_splitting"] or {}
                key = (h21, finite, kind, parity, row["omega_parity"], row["smoothness"],
                       mask, state, row["euler_fixed"], points, split.get("h11_minus"),
                       split.get("h21_minus"))
                groups[key].append(base + number)
    ranges = {}
    with open(work_file, "wb") as output:
        for key, members in groups.items():
            ranges[key] = (output.tell(), len(members))
            if sys.byteorder == "big":
                members.byteswap()
            members.tofile(output)
    return work_file, ranges


def gzip_bytes(path, data):
    with path.open("wb") as target, gzip.GzipFile(filename="", mode="wb", compresslevel=5,
                                                   fileobj=target, mtime=0) as stream:
        stream.write(data)


def write_rank(directory, parts, polys, tri_stride, action_stride, rank, expected):
    by_key = defaultdict(list)
    for name, ranges in parts:
        for key, (position, count) in ranges.items():
            by_key[key].append((name, position, count))
    directory.mkdir(parents=True)
    group_rows, page, start, page_number = [], bytearray(), 0, 0
    with ExitStack() as stack:
        inputs = {name: stack.enter_context(open(name, "rb")) for name, _ in parts}
        for key in sorted(by_key, key=lambda x: json.dumps(x, separators=(",", ":"))):
            positions = by_key[key]
            count = sum(item[2] for item in positions)
            group_rows.append([*key, count, start])
            start += count
            for name, position, n in positions:
                src = inputs[name]
                src.seek(position)
                remaining = n * 8
                while remaining:
                    size = min(remaining, PAGE_ROWS * 8 - len(page))
                    buf = src.read(size)
                    if len(buf) != size:
                        raise ValueError("Incomplete temporary postings")
                    page.extend(buf)
                    remaining -= size
                    if len(page) == PAGE_ROWS * 8:
                        gzip_bytes(directory / f"p{page_number}.bin.gz", page)
                        page.clear()
                        page_number += 1
    if page:
        gzip_bytes(directory / f"p{page_number}.bin.gz", page)
    if start != expected:
        raise ValueError(f"h11={rank}: {start} indexed eigenfamilies, expected {expected}")
    meta = dict(version=1, rank=rank, fields=FIELDS, groups=group_rows, polytopes=polys,
                tri_stride=tri_stride, action_stride=action_stride, chunk_size=PAGE_ROWS)
    gzip_bytes(directory / "groups.json.gz", json.dumps(meta, separators=(",", ":")).encode())
    nbytes = sum(p.stat().st_size for p in directory.iterdir())
    print(f"h11={rank}: {start:,} records, {len(group_rows):,} distinct signatures, "
          f"{nbytes:,} bytes", flush=True)


def build_rank(data, output, config, pool):
    rank = config["value"]
    index = json.loads((data / config["batch_index"]).read_bytes())
    polys = sorted(index["polytopes"])
    if len(polys) != config["polytopes"]:
        raise ValueError(f"h11={rank}: polytope count disagrees with the manifest")
    poly_slots = {p: i for i, p in enumerate(polys)}
    paths = [data / index["batches"][b]["file"] for b in sorted(index["batches"])]
    pieces = [paths[i:i+PART_BATCHES] for i in range(0, len(paths), PART_BATCHES)]
    sizes = list(pool.map(measure, [(rank, piece) for piece in pieces]))
    if sum(s[2] for s in sizes) != config["triangulations"] or sum(s[3] for s in sizes) != config["involutions"]:
        raise ValueError(f"h11={rank}: geometry count disagrees with the manifest")
    tri_stride = max(s[0] for s in sizes) + 1
    action_stride = max(s[1] for s in sizes) + 1
    if len(polys) * tri_stride * action_stride > 2**53 or array("d").itemsize != 8:
        raise ValueError("A wider record locator format is required for this edition")
    with tempfile.TemporaryDirectory() as tmp:
        jobs = [(rank, piece, poly_slots, tri_stride, action_stride, Path(tmp) / f"part{i}")
                for i, piece in enumerate(pieces)]
        parts = list(pool.map(index_part, jobs))
        write_rank(output / f"h{rank}", parts, polys, tri_stride, action_stride,
                   rank, config["sectors"])


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("data", type=Path, help="Public data/ directory after prepare_pages.py")
    p.add_argument("output", type=Path, help="Target search/ directory")
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--ranks", nargs="+", type=int, help="Build selected ranks for testing")
    args = p.parse_args()
    manifest = json.loads((args.data / "manifest.json").read_bytes())
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        for config in manifest["h11"]:
            if args.ranks is None or config["value"] in args.ranks:
                build_rank(args.data, args.output, config, pool)


if __name__ == "__main__":
    main()
