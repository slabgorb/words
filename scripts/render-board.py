#!/usr/bin/env python3
"""Render an inlaid backgammon board from two textures.

Usage:
  scripts/render-board.py --style marble-parquet
  scripts/render-board.py --style marble-noir --out preview.png
  scripts/render-board.py --light tex/a.png --dark tex/b.jpg --out board.png
  scripts/render-board.py --all
  scripts/render-board.py --list-styles

Styles bundle a pair of textures plus tuning constants. Per-flag overrides
beat preset values.

The board is composed quadrant-at-a-time. Each quadrant has 6 alternating
darts (3 light, 3 dark), inlaid into a third "field" tone (a blend of the
two source textures). A normal-map-style bevel pass runs at every cut edge.
Edges are anti-aliased by supersampling the masks before downsampling.
"""

from __future__ import annotations
import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


# ── Repo-relative paths ──────────────────────────────────────────────────

REPO = Path(__file__).resolve().parent.parent
WORDS_ASSETS = REPO / "plugins/words/client/assets"
BG_ASSETS    = REPO / "plugins/backgammon/client/assets"


# ── Style presets ────────────────────────────────────────────────────────

#  CSS-fit geometry: matches the backgammon plugin's .board layout
#  (16:10 wrap, 22px padding, 36px bar, 24px middle gap, 56px off-tray
#  on right). PNG renders at 1600×1000 with frame_l/r/t/b chosen so each
#  visible region (frame, quad, bar, off-tray-area) maps 1:1 to the CSS
#  grid cell that overlays it.
CSS_FIT = {
    "width":        1600,
    "height":       1000,   # 16:10
    "frame":         35,    # 22px CSS × 1.6 scale (top, bottom, left)
    "frame_right":  125,    # 22 right padding + 56 off-tray + 2 margin = 80px → 125 PNG
    "bar":           58,    # 36px CSS × 1.6
}

STYLES: dict[str, dict] = {
    "marble-parquet": {
        "description": "Cream marble inlay on dark parquet wood",
        "light": WORDS_ASSETS / "tile-marble.png",
        "dark":  WORDS_ASSETS / "board-wood.jpg",
        "field_blend": 0.55,
        "bevel":       5.5,
        "bevel_alpha": 0.50,
        **CSS_FIT,
    },
    "ivory-walnut": {
        "description": "Pale oak inlay on dark walnut parquet",
        "light": WORDS_ASSETS / "board-ivory.jpg",
        "dark":  WORDS_ASSETS / "board-wood.jpg",
        "field_blend": 0.40,
        "bevel":       5.5,
        "bevel_alpha": 0.45,
        **CSS_FIT,
    },
    "marble-noir": {
        "description": "Silver-white marble inlay on dark parquet",
        "light": WORDS_ASSETS / "board-marble.jpg",
        "dark":  WORDS_ASSETS / "board-wood.jpg",
        "field_blend": 0.50,
        "bevel":       5.5,
        "bevel_alpha": 0.50,
        **CSS_FIT,
    },
}


# ── Texture helpers ──────────────────────────────────────────────────────

def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    sw, sh = img.size
    s = max(w / sw, h / sh)
    nw, nh = int(round(sw * s)), int(round(sh * s))
    img = img.resize((nw, nh), Image.LANCZOS)
    x = (nw - w) // 2
    y = (nh - h) // 2
    return img.crop((x, y, x + w, y + h))


def blend_rgb(a: Image.Image, b: Image.Image, t: float) -> Image.Image:
    aa = np.asarray(a, dtype=np.float32)
    bb = np.asarray(b, dtype=np.float32)
    out = (1 - t) * aa + t * bb
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB")


def field_overlay(dark: Image.Image, light: Image.Image, *, alpha: float) -> Image.Image:
    """Build the field tone by tinting `dark` toward the AVERAGE colour of
    `light`.

    Blending the two pixel-for-pixel bleeds marble veins into the wood
    grain. Sampling a single colour from `light` and lerping `dark` toward
    it preserves wood structure (each pixel just moves a uniform amount
    toward the same target) while warming the field to a tone that
    contrasts with both the full-strength dark inlay darts and the bright
    marble darts.

    `alpha` dials the strength: 0 = pure dark texture, 1 = solid tint.
    """
    d = np.asarray(dark, dtype=np.float32) / 255.0
    avg = np.asarray(light, dtype=np.float32).reshape(-1, 3).mean(axis=0) / 255.0
    target = np.broadcast_to(avg.astype(np.float32), d.shape)
    out = (1 - alpha) * d + alpha * target
    return Image.fromarray(np.clip(out * 255, 0, 255).astype(np.uint8), "RGB")


# ── Geometry (quadrant-at-a-time) ────────────────────────────────────────

def render_quadrant_mask(w: int, h: int, *, points_down: bool, want_offset: int) -> Image.Image:
    """Mask for one quadrant. Fills the 3 darts whose slot index matches
    (i % 2) == want_offset. Bases tile the long edge; apexes meet inner."""
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    point_w = w / 6
    for i in range(6):
        if i % 2 != want_offset:
            continue
        bl_x = i * point_w
        br_x = (i + 1) * point_w
        ax_x = (i + 0.5) * point_w
        if points_down:
            poly = [(bl_x, 0), (br_x, 0), (ax_x, h)]
        else:
            poly = [(bl_x, h), (br_x, h), (ax_x, 0)]
        draw.polygon(poly, fill=255)
    return mask


def build_masks(width: int, height: int,
                frame_l: int, frame_r: int, frame_t: int, frame_b: int,
                bar: int, quad_h_ratio: float, supersample: int
                ) -> tuple[Image.Image, Image.Image]:
    """Build dark + light masks at supersampled resolution then downsample
    with LANCZOS so the dart slants come out anti-aliased.

    Per-side frame thicknesses (frame_l/r/t/b) let the renderer match
    asymmetric layouts — e.g. a CSS board where the right edge has a
    wider 'frame' that the off-tray/dice cabinet sits on top of."""
    s = max(1, int(supersample))
    sw, sh = width * s, height * s
    sfL, sfR = frame_l * s, frame_r * s
    sfT, sfB = frame_t * s, frame_b * s
    sbar = bar * s
    pa_top = sfT
    pa_bot = sh - sfB
    quad_h = int((pa_bot - pa_top) * quad_h_ratio)

    pa_left  = sfL
    pa_right = sw - sfR
    bar_cx   = (pa_left + pa_right) // 2
    left_x1  = pa_left
    left_x2  = bar_cx - sbar // 2
    right_x1 = bar_cx + sbar // 2
    side_w   = left_x2 - left_x1

    dark_mask  = Image.new("L", (sw, sh), 0)
    light_mask = Image.new("L", (sw, sh), 0)

    d = ImageDraw.Draw(dark_mask)
    d.rectangle([0, 0, sw - 1, sh - 1],                              fill=255)
    d.rectangle([sfL, sfT, sw - sfR - 1, sh - sfB - 1],              fill=0)
    d.rectangle([left_x2, sfT, right_x1 - 1, sh - sfB - 1],          fill=255)

    quadrants = [
        # (ox, oy, points_down, dark_offset) — frame-side dart kept light.
        (left_x1,  pa_top,           True,  1),
        (right_x1, pa_top,           True,  0),
        (left_x1,  pa_bot - quad_h,  False, 1),
        (right_x1, pa_bot - quad_h,  False, 0),
    ]
    for ox, oy, pd, doff in quadrants:
        qd = render_quadrant_mask(side_w, quad_h, points_down=pd, want_offset=doff)
        ql = render_quadrant_mask(side_w, quad_h, points_down=pd, want_offset=1 - doff)
        dark_mask.paste(qd,  (ox, oy), qd)
        light_mask.paste(ql, (ox, oy), ql)

    if s > 1:
        dark_mask  = dark_mask.resize((width, height),  Image.LANCZOS)
        light_mask = light_mask.resize((width, height), Image.LANCZOS)

    return dark_mask, light_mask


# ── Bevel & shadow ───────────────────────────────────────────────────────

def overlay_blend(base: Image.Image, gray_top: Image.Image, alpha: float = 1.0) -> Image.Image:
    a = np.asarray(base, dtype=np.float32) / 255.0
    g = np.asarray(gray_top, dtype=np.float32) / 255.0
    g3 = np.stack([g, g, g], axis=-1)
    blend = np.where(a < 0.5, 2 * a * g3, 1 - 2 * (1 - a) * (1 - g3))
    out = (1 - alpha) * a + alpha * blend
    return Image.fromarray(np.clip(out * 255, 0, 255).astype(np.uint8), "RGB")


def bevel_overlay(mask: Image.Image, *, blur: float = 1.6, strength: float = 6.0) -> Image.Image:
    m = np.asarray(mask.filter(ImageFilter.GaussianBlur(radius=blur)),
                   dtype=np.float32) / 255.0
    gx = np.gradient(m, axis=1)
    gy = np.gradient(m, axis=0)
    light = (-0.6, -0.6)
    shading = np.tanh((light[0] * gx + light[1] * gy) * strength)
    out = (0.5 + 0.5 * shading) * 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "L")


def add_inner_shadow(img: Image.Image, mask: Image.Image, *, radius: int = 10,
                     darken: float = 0.20) -> Image.Image:
    blurred = mask.filter(ImageFilter.GaussianBlur(radius=radius))
    m = np.asarray(mask, dtype=np.float32) / 255.0
    b = np.asarray(blurred, dtype=np.float32) / 255.0
    shadow = m * (1 - b) * darken
    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = arr * (1 - shadow[..., None])
    return Image.fromarray(np.clip(arr * 255, 0, 255).astype(np.uint8), "RGB")


# ── Compose ──────────────────────────────────────────────────────────────

def render_board(*, light_path: Path, dark_path: Path, out_path: Path,
                 width: int, height: int,
                 frame: int, bar: int,
                 frame_l: int | None = None, frame_r: int | None = None,
                 frame_t: int | None = None, frame_b: int | None = None,
                 quad_h_ratio: float, field_blend: float,
                 bevel_strength: float, bevel_alpha: float,
                 inner_shadow: float, supersample: int) -> None:
    fl = frame if frame_l is None else frame_l
    fr = frame if frame_r is None else frame_r
    ft = frame if frame_t is None else frame_t
    fb = frame if frame_b is None else frame_b

    light = cover(Image.open(light_path).convert("RGB"), width, height)
    dark  = cover(Image.open(dark_path ).convert("RGB"), width, height)
    field = field_overlay(dark, light, alpha=field_blend)

    dark_mask, light_mask = build_masks(width, height, fl, fr, ft, fb, bar,
                                        quad_h_ratio, supersample)

    board = field
    board = Image.composite(light, board, light_mask)
    board = Image.composite(dark,  board, dark_mask)

    combined = ImageChops.lighter(light_mask, dark_mask)
    bevel = bevel_overlay(combined, blur=1.6, strength=bevel_strength)
    board = overlay_blend(board, bevel, alpha=bevel_alpha)

    if inner_shadow > 0:
        board = add_inner_shadow(board, dark_mask,  radius=8, darken=inner_shadow)
        board = add_inner_shadow(board, light_mask, radius=8, darken=inner_shadow * 0.5)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    board.save(out_path)


def default_out(style: str) -> Path:
    return BG_ASSETS / f"board-{style}.png"


# ── CLI ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description="Inlaid backgammon board from two textures.")
    ap.add_argument("--list-styles", action="store_true",
                    help="List available style presets and exit.")
    ap.add_argument("--all", action="store_true",
                    help="Render every preset to its default destination under "
                         "plugins/backgammon/client/assets/.")
    ap.add_argument("--style", choices=sorted(STYLES.keys()),
                    help="Preset bundle of textures + tuning. Per-flag overrides win.")
    ap.add_argument("--light", type=Path, help="Light texture (alt darts).")
    ap.add_argument("--dark",  type=Path, help="Dark texture (frame, bar, alt darts).")
    ap.add_argument("--out",   type=Path,
                    help=f"Output path. Defaults to {BG_ASSETS}/board-<style>.png "
                         f"when --style is given.")

    # Geometry
    ap.add_argument("--width",        type=int)
    ap.add_argument("--height",       type=int)
    ap.add_argument("--frame",        type=int, help="Frame thickness in px (all sides).")
    ap.add_argument("--frame-left",   type=int, help="Override left frame thickness.")
    ap.add_argument("--frame-right",  type=int, help="Override right frame thickness.")
    ap.add_argument("--frame-top",    type=int, help="Override top frame thickness.")
    ap.add_argument("--frame-bottom", type=int, help="Override bottom frame thickness.")
    ap.add_argument("--bar",          type=int, help="Center-bar width in px.")
    ap.add_argument("--quad-h-ratio", type=float,
                    help="Dart depth as a fraction of playing-area height (0..0.5).")

    # Tone
    ap.add_argument("--field-blend",  type=float,
                    help="Field overlay strength: 0=pure dark texture, "
                         "1=full overlay of light onto dark.")

    # Effects
    ap.add_argument("--bevel",        type=float, help="Bevel strength at cut edges.")
    ap.add_argument("--bevel-alpha",  type=float, help="Bevel opacity (0..1).")
    ap.add_argument("--inner-shadow", type=float,
                    help="Inset shadow strength on darts (0..1).")
    ap.add_argument("--supersample",  type=int,
                    help="Anti-alias mask edges via NxN supersample (default 4).")

    args = ap.parse_args()

    if args.list_styles:
        for name, cfg in sorted(STYLES.items()):
            print(f"  {name:18s} {cfg.get('description', '')}")
        return

    defaults = dict(
        light=None, dark=None,
        width=1600, height=1100, frame=80, bar=80,
        quad_h_ratio=0.48, field_blend=0.45,
        bevel=5.5, bevel_alpha=0.50, inner_shadow=0.18,
        supersample=4,
    )

    def render_one(style_name: str | None, out: Path) -> None:
        preset = STYLES.get(style_name, {}) if style_name else {}

        def pick(k):
            v = getattr(args, k.replace("-", "_"), None)
            if v is not None:
                return v
            if k in preset:
                return preset[k]
            return defaults[k]

        light = pick("light")
        dark  = pick("dark")
        if light is None or dark is None:
            ap.error("--light and --dark are required (or use --style).")

        def pick_opt(k):
            v = getattr(args, k.replace("-", "_"), None)
            if v is not None:
                return v
            if k in preset:
                return preset[k]
            return None

        render_board(
            light_path=light, dark_path=dark, out_path=out,
            width=pick("width"), height=pick("height"),
            frame=pick("frame"), bar=pick("bar"),
            frame_l=pick_opt("frame_left"),
            frame_r=pick_opt("frame_right"),
            frame_t=pick_opt("frame_top"),
            frame_b=pick_opt("frame_bottom"),
            quad_h_ratio=pick("quad_h_ratio"),
            field_blend=pick("field_blend"),
            bevel_strength=pick("bevel"),
            bevel_alpha=pick("bevel_alpha"),
            inner_shadow=pick("inner_shadow"),
            supersample=pick("supersample"),
        )
        print(f"wrote {out}")

    if args.all:
        for name in sorted(STYLES.keys()):
            render_one(name, default_out(name))
        return

    out = args.out or (default_out(args.style) if args.style else None)
    if out is None:
        ap.error("--out is required when not using --style or --all.")
    render_one(args.style, out)


if __name__ == "__main__":
    main()
