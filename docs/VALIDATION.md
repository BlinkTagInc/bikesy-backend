# Source handoff validation — October 5, 2026

The release takes its runtime JS, supervisor, UI and active scenario config from the verified deployed source, not the older parent adapter. `release.json` records the exact hashes and immutable VCR digest. The staging grid, bridge presets, counted stairs and unchanged hill settings are retained.

Checks performed on the clean package:

- 47 JavaScript and 11 Python tests passed; JS syntax checks passed.
- The complete patch reconstructs the pinned engine source exactly. An offline fresh compilation using the existing toolchain reproduced engine SHA `82c32a1218531ac87de394699791212e32989147f3c17b705140cbac35fa755d`.
- 27 real-Lua access cases, 13 facility cases and compiled policy/connectivity assertions passed.
- An offline Docker source-overlay build verified the engine and all 56 data files against the deployed locks. It used the equivalent cached local image as the base override, not an authenticated VCR pull.
- Eight isolated runtime cases matched saved deployed-candidate paths, directions, distances and walking warnings exactly, with elevation present and correct engine/stair headers. The container had no external network or published host port.
- Source archive inspection excludes credentials, `.vercel`, PBF/HGT/tiles/database/executable outputs, unrelated projects and experimental detour-selection code. Parent source edits are preserved.

The earlier cloud validation is summarized in `deployed-validation.json`: 270 exact route payloads, 36 live old/new routes and common profiles, 90 bridge response displays, 16 presets and four viewport widths. Those are historical verified results, not newly repeated cloud traffic.

Still unverified: GitHub repository connection, native Git build pulling the private VCR base, branch-triggered delivery, and the first subsequent data release through the new hash-receipt packaging step. No cloud deployment, production promotion, Git push, credential creation, domain change or new storage upload occurred during source packaging.
