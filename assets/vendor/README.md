# Vendored third-party assets

See [`../README.md`](../README.md) for the master asset index and per-pack
provenance. Each pack keeps its own upstream licence file; this directory
records where the art came from and under what terms.

All vendored packs are CC0. Only the consumed packed sheet + licence file are
vendored for each — the full upstream archives (unpacked per-tile PNGs, Tiled
`.tsx`/`.tmx`, Construct 3 `.c3p`, preview/sample images) are deliberately not
kept, since the LDtk and sprite pipelines only ever import the packed sheet.
Re-download from the source URLs in `../README.md` if you need the rest.
