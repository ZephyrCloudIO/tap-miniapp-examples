#!/usr/bin/env python3
"""Build the four-frame enemy atlas consumed by the Rust canvas renderer.

Requires the Pillow version pinned in ``scripts/requirements-assets.txt``.
Each reviewed source is a transparent 2-by-2 pose sheet. The four complete
3-by-2 character pages are stacked vertically so the stable gameplay-kind
mapping does not change when the renderer advances a frame.
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, __version__ as PILLOW_VERSION


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "assets" / "sprites" / "featured-enemies" / "animation-sheets"
OUTPUT = ROOT / "assets" / "sprites" / "brainrot-enemies-canonical.png"
CELL_SIZE = 512
PADDING = 18
SHEET_SIZE = 1254
SHEET_COLUMNS = 2
SHEET_ROWS = 2
FRAME_COUNT = SHEET_COLUMNS * SHEET_ROWS
GROUND_BASELINE = CELL_SIZE - PADDING
EXPECTED_PILLOW_VERSION = "11.2.1"

# Row-major order is a serialized renderer contract:
# basic, fast, armored, swarm, disruption, boss.
SPRITES = (
    "tralalero.png",
    "cappuccino.png",
    "tung.png",
    "ballerina.png",
    "boneca.png",
    "la-vaca.png",
)


def nearest_visible_seed(alpha: Image.Image, index: int) -> tuple[int, int]:
    tile_width = alpha.width // SHEET_COLUMNS
    tile_height = alpha.height // SHEET_ROWS
    start_x = (index % SHEET_COLUMNS) * tile_width
    start_y = (index // SHEET_COLUMNS) * tile_height
    center_x = start_x + tile_width // 2
    center_y = start_y + tile_height // 2
    pixels = alpha.load()
    nearest: tuple[int, tuple[int, int]] | None = None
    for y in range(start_y, start_y + tile_height):
        for x in range(start_x, start_x + tile_width):
            if pixels[x, y] == 0:
                continue
            distance = (x - center_x) ** 2 + (y - center_y) ** 2
            if nearest is None or distance < nearest[0]:
                nearest = (distance, (x, y))
    if nearest is None:
        raise ValueError(f"frame {index} has no visible pixels")
    return nearest[1]


def isolated_frames(sheet: Image.Image, path: Path) -> tuple[Image.Image, ...]:
    alpha = sheet.getchannel("A")
    binary_alpha = alpha.point(lambda value: 255 if value else 0)
    frames: list[Image.Image] = []
    frame_pixels: set[tuple[tuple[int, int], bytes]] = set()
    for index in range(FRAME_COUNT):
        try:
            seed = nearest_visible_seed(alpha, index)
        except ValueError as error:
            raise ValueError(f"{path.name} {error}") from error

        # Generated poses can cross a 627-pixel guide. Flood-filling the main
        # alpha component recovers blades and bats across that guide without
        # importing pixels from the neighboring pose. Detached motion streaks
        # and generation debris are intentionally left behind.
        component_map = binary_alpha.copy()
        ImageDraw.floodfill(component_map, seed, 128, thresh=0)
        component_mask = component_map.point(lambda value: 255 if value == 128 else 0)
        if component_mask.histogram()[255] < 1024:
            raise ValueError(f"{path.name} frame {index} has no substantial pose")

        frame = sheet.copy()
        frame.putalpha(ImageChops.multiply(alpha, component_mask))
        alpha_bounds = frame.getchannel("A").getbbox()
        if alpha_bounds is None:
            raise ValueError(f"{path.name} frame {index} has no visible pixels")
        frame = frame.crop(alpha_bounds)
        pixels = (frame.size, frame.tobytes())
        if pixels in frame_pixels:
            raise ValueError(f"{path.name} frame {index} duplicates an earlier pose")
        frame_pixels.add(pixels)
        frames.append(frame)
    return tuple(frames)


def normalized_frames(path: Path) -> tuple[Image.Image, ...]:
    sheet = Image.open(path).convert("RGBA")
    if sheet.size != (SHEET_SIZE, SHEET_SIZE):
        raise ValueError(
            f"{path.name} must be {SHEET_SIZE}x{SHEET_SIZE}; received "
            f"{sheet.width}x{sheet.height}"
        )

    frames = isolated_frames(sheet, path)

    # One scale per character prevents independently cropped poses from
    # breathing in and out. Every pose shares the same bottom ground baseline.
    limit = CELL_SIZE - PADDING * 2
    max_width = max(frame.width for frame in frames)
    max_height = max(frame.height for frame in frames)
    scale = min(limit / max_width, limit / max_height)
    return tuple(
        frame.resize(
            (
                max(1, round(frame.width * scale)),
                max(1, round(frame.height * scale)),
            ),
            Image.Resampling.LANCZOS,
        )
        for frame in frames
    )


def main() -> None:
    if PILLOW_VERSION != EXPECTED_PILLOW_VERSION:
        raise RuntimeError(
            "enemy atlas generation requires Pillow "
            f"{EXPECTED_PILLOW_VERSION}; received {PILLOW_VERSION}"
        )
    atlas = Image.new(
        "RGBA",
        (CELL_SIZE * 3, CELL_SIZE * 2 * FRAME_COUNT),
        (0, 0, 0, 0),
    )

    for index, filename in enumerate(SPRITES):
        source = SOURCE_DIR / filename
        if not source.is_file():
            raise FileNotFoundError(source)

        for frame_index, sprite in enumerate(normalized_frames(source)):
            cell_x = (index % 3) * CELL_SIZE
            cell_y = (frame_index * 2 + index // 3) * CELL_SIZE
            x = cell_x + (CELL_SIZE - sprite.width) // 2
            y = cell_y + GROUND_BASELINE - sprite.height
            atlas.alpha_composite(sprite, (x, y))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUTPUT, format="PNG", optimize=True)
    print(f"Wrote {OUTPUT} ({atlas.width}x{atlas.height})")


if __name__ == "__main__":
    main()
