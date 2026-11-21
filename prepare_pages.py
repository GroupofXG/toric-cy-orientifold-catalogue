"""Verify and expand the versioned data asset into the static reader directory."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
from zipfile import ZipFile


def install(archive, site):
    lock = json.loads((Path(__file__).parent / "edition.json").read_bytes())["pages_data"]
    with archive.open("rb") as stream:
        if hashlib.file_digest(stream, "sha256").hexdigest() != lock["sha256"] or archive.stat().st_size != lock["bytes"]:
            raise ValueError("Data asset differs from the edition lock")
    with ZipFile(archive) as src:
        if len(src.namelist()) != lock["files"] or len(set(src.namelist())) != lock["files"]:
            raise ValueError("Archive member count differs")
        for info in src.infolist():
            path = PurePosixPath(info.filename)
            if not path.parts or path.parts[0] != "data" or ".." in path.parts or "\\" in info.filename:
                raise ValueError("Unexpected member name")
            dest = site.joinpath(*path.parts)
            dest.parent.mkdir(parents=True, exist_ok=True)
            with src.open(info) as reader, dest.open("xb") as out:
                shutil.copyfileobj(reader, out, 1024*1024)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("site", type=Path)
    args = parser.parse_args()
    install(args.archive, args.site)
