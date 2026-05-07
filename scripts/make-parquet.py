#!/usr/bin/env python3
"""Generate a parquet-tile pattern from a single texture.

Usage:
  scripts/make-parquet.py --style marble-cream
  scripts/make-parquet.py --style stone-slate --out my-parquet.jpg
  scripts/make-parquet.py --src tex.png --out parquet.jpg
  scripts/make-parquet.py --all
  scripts/make-parquet.py --list-styles

A parquet pattern: a square texture is cropped, scaled, and laid down in a
grid where every other tile is rotated 90 degrees so the grain alternates
horizontal/vertical (the "checkerboard wood floor" look). Optional grout
lines + per-tile brightness jitter sell the inlay feel.
"""

from __future__ import annotations
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance


REPO = Path(__file__).resolve().parent.parent
WORDS_ASSETS = REPO / "plugins/words/client/assets"


STYLES: dict[str, dict] = {
    # ── Single-texture (rotation-alternated) parquets ───────────────────
    # NB: grid=15 so output maps 1:1 to the words 15×15 board grid.
    "marble-cream": {
        "description": "Cream-marble parquet (warm, single texture)",
        "src":         WORDS_ASSETS / "tile-marble.png",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.50, "vary": 0.04,
    },
    "marble-silver": {
        "description": "Silver-marble parquet (cool, single texture)",
        "src":         WORDS_ASSETS / "board-marble.jpg",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.45, "vary": 0.05,
    },
    "stone-slate": {
        "description": "Dark slate-stone parquet (single texture)",
        "src":         WORDS_ASSETS / "stone-slate.png",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.65, "vary": 0.05,
    },
    # ── Two-texture checkerboard parquets ───────────────────────────────
    "marble-slate-checker": {
        "description": "Cream marble × dark slate checkerboard",
        "src":         WORDS_ASSETS / "tile-marble.png",
        "src2":        WORDS_ASSETS / "stone-slate.png",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.55, "vary": 0.04,
    },
    "ivory-walnut-floor": {
        "description": "Pale oak × dark walnut checkerboard",
        "src":         WORDS_ASSETS / "board-ivory.jpg",
        "src2":        WORDS_ASSETS / "board-wood.jpg",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.55, "vary": 0.04,
    },
    # ── Two-tone checker variants for the parquet-* board themes ────────
    # These pair tonally-close textures so the theme keeps its mood
    # (cream/silver/slate) but the alternation is clearly visible.
    "marble-cream-checker": {
        "description": "Cream marble × pale oak (warm cream theme)",
        "src":         WORDS_ASSETS / "tile-marble.png",
        "src2":        WORDS_ASSETS / "board-ivory.jpg",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.50, "vary": 0.04,
    },
    "marble-silver-checker": {
        "description": "Silver marble × cream marble (cool silver theme)",
        "src":         WORDS_ASSETS / "board-marble.jpg",
        "src2":        WORDS_ASSETS / "tile-marble.png",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.50, "vary": 0.04,
    },
    "stone-slate-checker": {
        "description": "Dark slate × silver marble (dramatic slate theme)",
        "src":         WORDS_ASSETS / "stone-slate.png",
        "src2":        WORDS_ASSETS / "board-marble.jpg",
        "tile_size":   140, "grid": 15,
        "grout":       2,   "grout_alpha": 0.65, "vary": 0.05,
    },
}


# ── Helpers ──────────────────────────────────────────────────────────────

def square_crop(img: Image.Image) -> Image.Image:
    s = min(img.size)
    x = (img.width  - s) // 2
    y = (img.height - s) // 2
    return img.crop((x, y, x + s, y + s))


def random_crop(img: Image.Image, size: int, rng: np.random.Generator) -> Image.Image:
    """Pick a random size×size crop from anywhere in the source. Falls back
    to a centered cover-resize when the source is too small."""
    if img.width < size or img.height < size:
        s = max(size / img.width, size / img.height)
        nw, nh = int(round(img.width * s)) + 1, int(round(img.height * s)) + 1
        img = img.resize((nw, nh), Image.LANCZOS)
    x = int(rng.integers(0, img.width  - size + 1))
    y = int(rng.integers(0, img.height - size + 1))
    return img.crop((x, y, x + size, y + size))


def per_tile_inset(tile_size: int, depth: float = 0.18) -> Image.Image:
    """Soft inset shadow for one tile -- darker at edges, neutral at center.
    Returned as L-mode 'multiply' layer (255 = no change, 0 = full dark)."""
    n = tile_size
    yy, xx = np.mgrid[0:n, 0:n]
    cx, cy = (n - 1) / 2.0, (n - 1) / 2.0
    # Distance to nearest edge, normalised (0 at edge, 1 at center)
    edge_dist = np.minimum.reduce([xx, n - 1 - xx, yy, n - 1 - yy]) / (n / 2.0)
    edge_dist = np.clip(edge_dist, 0, 1)
    # Smooth ramp using cosine
    factor = 0.5 - 0.5 * np.cos(np.pi * edge_dist)  # 0 at edge → 1 at center
    shadow = 1 - depth * (1 - factor)               # 1 - depth at edge → 1 at center
    arr = (np.clip(shadow, 0, 1) * 255).astype(np.uint8)
    return Image.fromarray(arr, "L")


# ── Core ─────────────────────────────────────────────────────────────────

def make_parquet(src_path: Path, out_path: Path, *,
                 src2_path: Path | None = None,
                 tile_size: int = 140, grid: int = 11,
                 grout: int = 2, grout_alpha: float = 0.50,
                 vary: float = 0.08, inset: float = 0.18,
                 random_crops: bool = True,
                 seed: int = 12345) -> None:
    """Build a parquet pattern.

    Two modes:
      * single texture (src2_path=None): tiles alternate 90° rotation across
        the checkerboard so directional grain reads as parquet.
      * two textures (src2_path given): src and src2 alternate across the
        checkerboard. No rotation is applied -- the alternation itself is
        the parquet pattern (e.g., marble × slate, light wood × dark wood).

    random_crops: every tile gets a fresh random crop from its source so
        radially-symmetric textures (marble, stone) don't repeat the same
        center-spot in every cell.
    """
    src = Image.open(src_path).convert("RGB")
    src2 = Image.open(src2_path).convert("RGB") if src2_path else None

    fallback  = square_crop(src ).resize((tile_size, tile_size), Image.LANCZOS)
    fallback2 = (square_crop(src2).resize((tile_size, tile_size), Image.LANCZOS)
                 if src2 is not None else None)

    inset_layer = per_tile_inset(tile_size, depth=inset) if inset > 0 else None
    rng = np.random.default_rng(seed)
    W = H = tile_size * grid
    canvas = Image.new("RGB", (W, H))

    two_tex = src2 is not None

    for r in range(grid):
        for c in range(grid):
            even = (r + c) % 2 == 0
            if two_tex:
                source = src if even else src2
                fb     = fallback if even else fallback2
                tile = (random_crop(source, tile_size, rng).copy()
                        if random_crops else fb.copy())
                # No rotation: the texture-alternation IS the pattern.
            else:
                tile = (random_crop(src, tile_size, rng).copy()
                        if random_crops else fallback.copy())
                if even:
                    tile = tile.rotate(90)
            if vary > 0:
                f = 1 + (rng.random() - 0.5) * 2 * vary
                tile = ImageEnhance.Brightness(tile).enhance(f)
            if inset_layer is not None:
                arr = (np.asarray(tile, dtype=np.float32) *
                       (np.asarray(inset_layer, dtype=np.float32)[..., None] / 255.0))
                tile = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
            canvas.paste(tile, (c * tile_size, r * tile_size))

    if grout > 0:
        d = ImageDraw.Draw(canvas)
        col = int((1 - grout_alpha) * 255)
        half = max(1, grout // 2)
        for c in range(grid + 1):
            x = c * tile_size
            d.rectangle([x - half, 0, x + half - 1, H - 1], fill=(col, col, col))
        for r in range(grid + 1):
            y = r * tile_size
            d.rectangle([0, y - half, W - 1, y + half - 1], fill=(col, col, col))

    out_path.parent.mkdir(parents=True, exist_ok=True)
    if out_path.suffix.lower() in (".jpg", ".jpeg"):
        canvas.save(out_path, quality=92)
    else:
        canvas.save(out_path)


def default_out(style: str) -> Path:
    return WORDS_ASSETS / f"board-parquet-{style}.jpg"


# ── CLI ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Parquet-tile texture generator.")
    ap.add_argument("--list-styles", action="store_true")
    ap.add_argument("--all", action="store_true",
                    help="Render every preset to its default destination "
                         f"under {WORDS_ASSETS}.")
    ap.add_argument("--style", choices=sorted(STYLES.keys()))
    ap.add_argument("--src",  type=Path,
                    help="Primary texture. Required unless --style covers it.")
    ap.add_argument("--src2", type=Path,
                    help="Optional second texture. When given, the parquet is "
                         "a checkerboard of src/src2 (no rotation). Omit for a "
                         "single-texture rotation parquet.")
    ap.add_argument("--out", type=Path,
                    help=f"Output path. Defaults to {WORDS_ASSETS}/"
                         f"board-parquet-<style>.jpg when --style is given.")

    ap.add_argument("--tile-size",   type=int)
    ap.add_argument("--grid",        type=int)
    ap.add_argument("--grout",       type=int)
    ap.add_argument("--grout-alpha", type=float)
    ap.add_argument("--vary",        type=float, help="Per-tile brightness jitter (0..1).")
    ap.add_argument("--inset",       type=float, help="Per-tile inset shadow depth (0..1).")
    ap.add_argument("--no-random-crops", dest="random_crops", action="store_false",
                    default=None,
                    help="Use the same centered crop for every tile (deterministic, "
                         "best for textures with strong directional grain).")
    ap.add_argument("--seed",        type=int,   default=12345)

    args = ap.parse_args()

    if args.list_styles:
        for name, cfg in sorted(STYLES.items()):
            print(f"  {name:16s} {cfg.get('description', '')}")
        return

    defaults = dict(
        tile_size=140, grid=11, grout=2, grout_alpha=0.50,
        vary=0.08, inset=0.18, random_crops=True,
    )

    def render_one(style_name: str | None, src: Path | None, src2: Path | None,
                   out: Path) -> None:
        preset = STYLES.get(style_name, {}) if style_name else {}

        def pick(k):
            v = getattr(args, k.replace("-", "_"), None)
            if v is not None:
                return v
            if k in preset:
                return preset[k]
            return defaults[k]

        the_src  = src  or preset.get("src")
        the_src2 = src2 or preset.get("src2")
        if the_src is None:
            ap.error("--src or --style required")

        make_parquet(
            the_src, out,
            src2_path=the_src2,
            tile_size=pick("tile_size"),
            grid=pick("grid"),
            grout=pick("grout"),
            grout_alpha=pick("grout_alpha"),
            vary=pick("vary"),
            inset=pick("inset"),
            random_crops=pick("random_crops"),
            seed=args.seed,
        )
        print(f"wrote {out}")

    if args.all:
        for name in sorted(STYLES.keys()):
            render_one(name, None, None, default_out(name))
        return

    out = args.out or (default_out(args.style) if args.style else None)
    if out is None:
        ap.error("--out is required when not using --style or --all.")
    render_one(args.style, args.src, args.src2, out)


if __name__ == "__main__":
    main()
