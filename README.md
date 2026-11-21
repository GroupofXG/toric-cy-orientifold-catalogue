# Toric Calabi–Yau Orientifold Catalogue

This repository accompanies **Toric Calabi–Yau orientifolds: constructions, fixed loci and O-plane charges** by Xu Cao and Xin Gao. [arXiv:2611.22785](https://arxiv.org/abs/2611.22785)

**[Search by scientific properties](https://groupofxg.github.io/toric-cy-orientifold-catalogue/?search=1)** · [Look up a catalogue ID](https://groupofxg.github.io/toric-cy-orientifold-catalogue/#lookup) · [Download the data](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/tag/h1-h6-20261120) · [Reader’s guide](https://groupofxg.github.io/toric-cy-orientifold-catalogue/guide.html)

## Coverage

Edition `h1-h6-20261120` covers favourable polytopes at $h^{1,1}=1$ through $6$ and their fine, regular, star triangulations (FRSTs). For each FRST, the catalogue records the compatible divisor exchanges (NID) and the nontrivial reflection classes realised by Cox coordinate sign changes (REF). The two polynomial parities have separate records. Work on $h^{1,1}=7,8$ continues for later releases, with further computations planned at higher $h^{1,1}$.

| $h^{1,1}$ | Polytopes | FRSTs | Involutions | Eigenfamily records | Download |
|---:|---:|---:|---:|---:|---|
| 1 | 5 | 5 | 80 | 160 | [ZIP · 9 KB](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/h11-1-four-tables.zip) |
| 2 | 36 | 48 | 564 | 1,488 | [ZIP · 60 KB](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/h11-2-four-tables.zip) |
| 3 | 243 | 525 | 3,685 | 15,824 | [ZIP · 682 KB](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/h11-3-four-tables.zip) |
| 4 | 1,185 | 5,330 | 18,115 | 161,068 | [ZIP · 7.6 MB](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/h11-4-four-tables.zip) |
| 5 | 4,897 | 56,714 | 74,471 | 1,709,590 | [ZIP · 90 MB](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/h11-5-four-tables.zip) |
| 6 | 16,608 | 584,281 | 252,068 | 17,576,040 | [ZIP · 1.05 GB](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/h11-6-four-tables.zip) |
| **Total** | **22,974** | **646,903** | **348,983** | **19,464,170** | |

An involution is counted once on its polytope and can occur on several FRSTs. The smoothness field refers to a general member of the specified eigenfamily. In this edition 3,602 nonempty families have an unresolved smoothness verdict, recorded as `null`.

## Find a record

You can start with a physics question even if you do not know a catalogue ID. Select a Hodge number and the O-planes that must occur together, then narrow the results by involution type, parity or generic smoothness. Each match is one polynomial eigenfamily on one triangulation for one involution. Open its ID to inspect the fixed components and their equations, or share the query URL with a colleague.

* [Families with both O3 and O7 at $h^{1,1}=2$](https://groupofxg.github.io/toric-cy-orientifold-catalogue/?search=1&rank=2&planes=O3,O7) (152 eigenfamilies).
* [Smooth reflection families with O7 and whole fixed-set Euler characteristic 48 at $h^{1,1}=3$](https://groupofxg.github.io/toric-cy-orientifold-catalogue/?search=1&rank=3&kind=REF&planes=O7&smooth=smooth&euler=48) (231 eigenfamilies).
* [Local-D7 configurations with $L_{\mathrm{D3}}=12$ at $h^{1,1}=3$](https://groupofxg.github.io/toric-cy-orientifold-catalogue/?search=1&rank=3&d3=12) (257 eigenfamilies). This search uses equation (31) of the paper for smooth, Ω-odd families with a nonempty fixed set classified entirely as O3 or O7.

Paste a catalogue ID into the search page, or follow a record link directly. For example, `P2_1_T0_I1_Pplus` is the positive polynomial parity of divisor exchange 1 on triangulation 0 of polytope 1 at $h^{1,1}=2$. Its fixed locus is an O5 curve of Euler characteristic $-18$. The page also lets you switch to the other parity or export the selected triangulation and its associated records as JSON. [Open this example](https://groupofxg.github.io/toric-cy-orientifold-catalogue/?h=2&p=1&t=P2_1_T0&i=P2_1_I1&s=Pplus)

Each ZIP contains four UTF-8 JSON Lines tables. The IDs link each eigenfamily to its geometry and action.

| File | One row describes |
|---|---|
| `polytopes.jsonl` | A polytope and its ordered rays, Cox weights and finite actions. |
| `triangulations.jsonl` | An FRST of that polytope, with its Stanley–Reisner ideal, divisor data and intersection numbers. |
| `involutions.jsonl` | A divisor exchange or coordinate reflection on a polytope. |
| `orientifolds.jsonl` | A triangulation, an involution and a polynomial parity, with fixed loci, their Euler data and the generic smoothness verdict. |

In `orientifolds.jsonl`, use `triangulation_id` and `involution_id` to look up the corresponding rows. Every rank download includes `definitions/coefficients.jsonl`, which defines symbolic coefficients and algebraic roots by `orientifold_id`. Some original batch notes also refer to a companion evidence archive from the earlier computations. The release checksums identify the exact ZIP files distributed with this edition. [Field definitions in Appendix A](https://arxiv.org/html/2611.22785v1#A1.SS1) · [Archive checksums](https://github.com/GroupofXG/toric-cy-orientifold-catalogue/releases/download/h1-h6-20261120/SHA256SUMS.txt)

For a local search, download the ZIP for the Hodge number of interest. The supplied [Python script](select_families.py) reads the compressed archive directly. This query counts smooth REF eigenfamilies with an O7 component and a **whole fixed-set** Euler characteristic of 48 at $h^{1,1}=3$.

```sh
python select_families.py h11-3-four-tables.zip --kind REF --smoothness smooth --plane O7 --euler 48 --count
```

The result is 231. Omit `--count` to write the matching JSON Lines records to standard output.

## Original catalogue

The original divisor-exchange and coordinate-reflection data are available separately. For studies that use those files, cite the catalogue paper by Xu Cao, Hongfei Gao and Xin Gao. [Original repository](https://github.com/GroupofXG/anewcydatabase) · [Original data release](https://github.com/GroupofXG/anewcydatabase/releases/tag/data-v1) · [JHEP 10 (2024) 188](https://doi.org/10.1007/JHEP10(2024)188)

## Citation

When citing a record from this edition, give its catalogue ID, the release tag `h1-h6-20261120` and the accompanying paper.

```bibtex
@misc{Cao:2026oee,
  author        = {Cao, Xu and Gao, Xin},
  title         = {Toric {Calabi--Yau} orientifolds: constructions, fixed loci and {O-plane} charges},
  year          = {2026},
  eprint        = {2611.22785},
  archivePrefix = {arXiv},
  primaryClass  = {hep-th}
}
```
