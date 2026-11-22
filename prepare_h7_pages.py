"""Merge the pinned rank-seven browser and search data into an existing Pages build."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
from tempfile import TemporaryDirectory
from zipfile import ZipFile


MEMBER = re.compile(r"data/index/h7\.json|data/h7/h7_b[0-9]{5}\.json\.gz|search/h7/(groups\.json|p[0-9]+\.bin)\.gz")
RAW_BATCH = re.compile(r"https://raw\.githubusercontent\.com/GroupofXG/toric-cy-orientifold-catalogue/"
                       r"([0-9a-f]{40})/data/h7/([0-9]{3})/(h7_b[0-9]{5})\.json\.gz")
DOWNLOADS = "https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h7-20261122/"


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def validate(stage, rank):
    if (rank.get("value"), rank.get("format"), rank.get("batch_index")) != (7, "packed7-v1", "index/h7.json"):
        raise ValueError("Unexpected rank descriptor")
    if rank.get("bulk_url") != DOWNLOADS.rstrip("/").replace("/download/", "/tag/"):
        raise ValueError("Unexpected original-data release URL")
    index = json.loads((stage / "data" / rank["batch_index"]).read_bytes())
    batches, polytopes = index["batches"], index["polytopes"]
    if len(polytopes) != rank["polytopes"] or set(polytopes.values()) != set(batches):
        raise ValueError("Polytope count or batch coverage differs")
    expected = set()
    locations = set()
    for batch, record in batches.items():
        if not re.fullmatch(r"h7_b[0-9]{5}", batch) or not re.fullmatch(r"[0-9a-f]{64}", record["sha256"]):
            raise ValueError("Unexpected batch ID or SHA-256 digest")
        remote = RAW_BATCH.fullmatch(record["file"])
        if remote:
            if remote[3] != batch or remote[2] != f"{int(batch[4:]) // 128:03d}":
                raise ValueError("Remote file and batch IDs differ: " + batch)
            file = record.get("bulk_file")
            url = record.get("download_url")
            if url and not url.startswith(DOWNLOADS):
                raise ValueError("Unexpected original-data URL: " + batch)
            name = file or (url or "").removeprefix(DOWNLOADS)
            expected_volume = f"h11-7-four-tables-part{int(batch[4:]) // 256 + 1:03d}.zip"
            if name != expected_volume or url and url != DOWNLOADS + name:
                raise ValueError("Missing or inconsistent original-data volume: " + batch)
            locations.add(remote[1])
            continue
        locations.add("local")
        rel = "h7/" + batch + ".json.gz"
        if record["file"] != rel or not MEMBER.fullmatch("data/" + rel):
            raise ValueError("Unexpected batch path: " + batch)
        p = stage / "data" / rel
        if digest(p) != record["sha256"]:
            raise ValueError("Browser batch digest differs: " + batch)
        expected.add(p)
    local_data = stage / "data/h7"
    actual = set(local_data.iterdir()) if local_data.is_dir() else set()
    if len(locations) != 1 or actual != expected:
        raise ValueError("Unexpected browser batches")
    directory = stage / "search/h7"
    with gzip.open(directory / "groups.json.gz", "rt", encoding="utf-8") as f:
        meta = json.load(f)
    if (meta["version"], meta["rank"], meta["encoding"]) != (1, 7, "delta-varint-v1"):
        raise ValueError("Unexpected search format")
    if set(meta["polytopes"]) != set(polytopes) or len(meta["polytopes"]) != len(polytopes):
        raise ValueError("Search and browser polytope coverage differs")
    count, start = [meta["fields"].index(field) for field in ("count", "start")]
    records = 0
    for group in meta["groups"]:
        if group[start] != records or group[count] < 1:
            raise ValueError("Discontinuous search group offsets")
        records += group[count]
    if records != rank["sectors"] or meta["chunk_size"] < 1:
        raise ValueError("Search totals differ from the release")
    pages = (records + meta["chunk_size"] - 1) // meta["chunk_size"]
    if {p.name for p in directory.iterdir()} != {"groups.json.gz", *(f"p{i}.bin.gz" for i in range(pages))}:
        raise ValueError("Search postings pages differ from the index")


def install(directory, site, lock):
    if lock["tag"] != "h7-20261122":
        raise ValueError("Unexpected release tag")
    assets = {asset["file"]: asset for asset in lock["assets"]}
    if not assets or len(assets) != len(lock["assets"]) or set(assets) != {p.name for p in directory.glob("h7-pages-*.zip")}:
        raise ValueError("Release assets differ from the edition lock")
    manifest_file = site / "data/manifest.json"
    manifest = json.loads(manifest_file.read_bytes())
    if [r["value"] for r in manifest["h11"]] != list(range(1,7)):
        raise ValueError("Expected the installed ranks 1–6")
    targets = ["data/index/h7.json", "data/h7", "search/h7"]
    if any((site / rel).exists() for rel in targets):
        raise ValueError("Rank-seven files already exist in the build")
    with TemporaryDirectory(dir=site.parent) as folder:
        stage = Path(folder)
        for filename, asset in assets.items():
            if not re.fullmatch(r"h7-pages-[A-Za-z0-9._-]+\.zip", filename):
                raise ValueError("Unexpected release filename")
            path = directory / filename
            if path.stat().st_size != asset["bytes"] or digest(path) != asset["sha256"]:
                raise ValueError("Release asset differs from lock: " + filename)
            with ZipFile(path) as archive:
                for member in archive.infolist():
                    if not MEMBER.fullmatch(member.filename):
                        raise ValueError("Unexpected Pages member: " + member.filename)
                    dest = stage.joinpath(*PurePosixPath(member.filename).parts)
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(member) as src, dest.open("xb") as out:
                        shutil.copyfileobj(src, out, 1024*1024)
        validate(stage, lock["rank"])
        manifest["h11"].append(lock["rank"])
        manifest["version"] = "Ranks 1–6 · 2026-11-20 / Rank 7 · 2026-11-22"
        (stage / "combined.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
        moved = []
        try:
            for rel in targets:
                if not (stage / rel).exists():
                    continue
                (stage / rel).rename(site / rel)
                moved.append(rel)
            (stage / "combined.json").replace(manifest_file)
        except OSError:
            for rel in reversed(moved):
                (site / rel).rename(stage / rel)
            raise
    print(f"Installed {len(assets)} verified rank-seven Pages assets")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("site", type=Path)
    args = parser.parse_args()
    install(args.assets, args.site, json.loads(Path(__file__).with_name("h7-edition.json").read_bytes()))
