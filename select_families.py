"""Stream matching eigenfamilies from one of the published rank ZIPs."""
import argparse
import json
import re
import sys
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", help="h11-N-four-tables.zip")
    parser.add_argument("--id", help="exact orientifold_id")
    parser.add_argument("--kind", choices=("NID", "REF"))
    parser.add_argument("--omega", type=int, choices=(-1,1))
    parser.add_argument("--smoothness", choices=("smooth", "singular", "null"))
    parser.add_argument("--plane", choices=("O3","O5","O7","O9"),
                        help="at least one listed fixed locus of this type")
    parser.add_argument("--euler", type=int, help="Euler characteristic of the whole fixed set")
    parser.add_argument("--count", action="store_true", help="print the number of matching rows")
    args = parser.parse_args()
    count = 0
    with ZipFile(args.archive) as archive:
        members = [n for n in archive.namelist() if re.fullmatch(r"h11=\d+/orientifolds\.jsonl", n)]
        if len(members) != 1:
            parser.error("expected exactly one rank-level orientifolds.jsonl in the archive")
        actions = {}
        if args.kind:
            with archive.open(members[0].replace("orientifolds", "involutions")) as f:
                for row in map(json.loads, f):
                    actions[row["involution_id"]] = row["type"]
        with archive.open(members[0]) as f:
            for line in f:
                row = json.loads(line)
                if args.id and row["orientifold_id"] != args.id:
                    continue
                if args.kind and actions[row["involution_id"]] != {"NID":"divisor_exchange","REF":"reflection"}[args.kind]:
                    continue
                if args.omega is not None and row["omega_parity"] != args.omega:
                    continue
                if args.smoothness and row["smoothness"] != (None if args.smoothness == "null" else args.smoothness):
                    continue
                if args.euler is not None and row["euler_fixed"] != args.euler:
                    continue
                if args.plane and not any(loc["type"] == args.plane for loc in row["fixed_loci"] or []):
                    continue
                count += 1
                if not args.count:
                    sys.stdout.buffer.write(line)
    if args.count:
        print(count)


if __name__ == "__main__":
    main()
