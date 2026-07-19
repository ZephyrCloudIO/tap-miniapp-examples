# Featured enemy sprite provenance

The six transparent PNGs in `animation-sheets/` are image-generated 2-by-2
game-sprite pose sheets guided by the featured character cards on the
[Sprunky Brainrot character hub](https://sprunky.gg/brainrot-characters),
accessed 2026-07-17. Their four row-major poses preserve each card character's
defining silhouette, proportions, materials, colors, expression, and props
while removing the card environment and completing frame-clipped extremities
where required. The earlier one-pose cutouts beside this README remain visual
provenance only; neither they nor the pose sheets are imported into the runtime
package directly.

The upstream card files are not included in this repository. Their reference
order within every animation page and the stable renderer mapping are:

| Atlas cell | Gameplay kind | Presentation |
| --- | --- | --- |
| 0 | `basic` | Tralalero Tralala |
| 1 | `fast` | Cappuccino Assassino |
| 2 | `armored` | Tung Tung Tung Sahur |
| 3 | `swarm` | Ballerina Cappuccina |
| 4 | `disruption` | Boneca Ambalabu |
| 5 | `boss` | La Vaca Saturno Saturnita |

`scripts/build-enemy-atlas.py` uses the four quadrant centers as pose seeds and
isolates each pose's complete connected alpha silhouette. This recovers authored
blades, bats, and limbs that cross a quadrant guide without mixing in pixels
from the neighboring pose, while detached generation debris and motion streaks
are excluded. The builder then trims the transparent perimeter, applies one
shared scale and ground baseline to all four poses for that character, and
stacks four complete 3-by-2 pages in `brainrot-enemies-canonical.png`. The
resulting 1536-by-4096 RGBA atlas is the only enemy image consumed by the Rust
canvas renderer. Asset validation pins the reviewed sheet and atlas digests,
rejects empty or duplicate source regions, and verifies that all 24 atlas cells
retain their transparent safety padding.

The authored asset build uses `Pillow==11.2.1`, exact-pinned in
`scripts/requirements-assets.txt`. Install that isolated build dependency before
running `python3 scripts/build-enemy-atlas.py`; the checked-in atlas remains the
reviewed input to the normal application package build.

Sprunky publishes no permissive reuse license for its card graphics, and its
published terms restrict redistribution and modification. This example does
not claim ownership of the referenced card artwork or character designs.
Rights clearance or replacement art is required before distributing these
adaptations in a public product.
