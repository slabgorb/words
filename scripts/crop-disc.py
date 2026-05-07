#!/usr/bin/env python3
"""Crop a photographed game-disc PNG to a clean circular alpha cutout.

Usage:
  scripts/crop-disc.py --src ~/Projects/assets/game_pieces/disc_10.png \
                       --out checker-warm.png
  scripts/crop-disc.py --all     # process the curated promising set
  scripts/crop-disc.py --list

The source images are studio shots on near-white backgrounds. We:
  1. mask out the (roughly white) background,
  2. find the disc centroid,
  3. ray-march outward in many directions and take the MEDIAN radius
     (robust to drop-shadows that bleed off one side),
  4. apply a soft circular alpha mask at that radius,
  5. write a square RGBA PNG sized to fit the disc with a small margin.
"""

from __future__ import annotations
import argparse
from pathlib import Path

import numpy as np
from PIL import Image


REPO       = Path(__file__).resolve().parent.parent
BG_ASSETS  = REPO / "plugins/backgammon/client/assets"
SRC_DIR    = Path("~/Projects/assets/game_pieces").expanduser()


# Curated set: the rim+concentric-ring discs that read well at checker size.
PRESETS: dict[str, dict] = {
    "checker-warm": {
        "description": "Warm wood-grain disc with gold rim (disc_10)",
        "src":         SRC_DIR / "disc_10.png",
    },
    "checker-cool": {
        "description": "Cool plastic disc with concentric rings (disc_6)",
        "src":         SRC_DIR / "disc_6.png",
    },
    "checker-stone": {
        "description": "Stone-grey disc with thin gold inlay (disc_7)",
        "src":         SRC_DIR / "disc_7.png",
    },
}


# ── detection ────────────────────────────────────────────────────────────

def _foreground_mask(rgb: np.ndarray, bg_thresh: int = 232) -> np.ndarray:
    """True where the pixel is darker/more saturated than studio backdrop."""
    # Background in these shots is light grey/white. Anything where ALL
    # channels are >= bg_thresh is treated as background.
    return ~((rgb[..., 0] >= bg_thresh)
             & (rgb[..., 1] >= bg_thresh)
             & (rgb[..., 2] >= bg_thresh))


def _erode(mask: np.ndarray, iters: int = 2) -> np.ndarray:
    """Pure-numpy 3x3 binary erosion (rolling min). Strips edge halo."""
    m = mask.copy()
    for _ in range(iters):
        # 3x3 min: a pixel stays True iff all 8 neighbours + self are True.
        H, W = m.shape
        pad = np.zeros((H + 2, W + 2), dtype=bool)
        pad[1:-1, 1:-1] = m
        out = (pad[0:-2, 0:-2] & pad[0:-2, 1:-1] & pad[0:-2, 2:] &
               pad[1:-1, 0:-2] & pad[1:-1, 1:-1] & pad[1:-1, 2:] &
               pad[2:,   0:-2] & pad[2:,   1:-1] & pad[2:,   2:])
        m = out
    return m


def _largest_component(mask: np.ndarray) -> np.ndarray:
    """Pure-numpy flood-fill labelling, return mask of the largest blob.
    Iterative DFS on True pixels. Disc photos have ~1M pixels; fine."""
    H, W = mask.shape
    visited = np.zeros_like(mask)
    best = None
    best_size = 0
    # 4-connectivity is sufficient for a solid blob.
    nbrs = ((-1, 0), (1, 0), (0, -1), (0, 1))
    # Process row-by-row; stack-based flood fill.
    for sy in range(H):
        for sx in range(W):
            if not mask[sy, sx] or visited[sy, sx]:
                continue
            stack = [(sy, sx)]
            comp = []
            while stack:
                y, x = stack.pop()
                if y < 0 or y >= H or x < 0 or x >= W:
                    continue
                if visited[y, x] or not mask[y, x]:
                    continue
                visited[y, x] = True
                comp.append((y, x))
                for dy, dx in nbrs:
                    stack.append((y + dy, x + dx))
            if len(comp) > best_size:
                best_size = len(comp)
                best = comp
    out = np.zeros_like(mask)
    if best:
        ys, xs = zip(*best)
        out[list(ys), list(xs)] = True
    return out


def _boundary_points(mask: np.ndarray) -> np.ndarray:
    """Return Nx2 array of (x, y) boundary pixel coords (mask & ~eroded)."""
    inner = _erode(mask, iters=1)
    edge = mask & ~inner
    ys, xs = np.where(edge)
    return np.stack([xs, ys], axis=1).astype(np.float64)


def _lsq_circle(points: np.ndarray) -> tuple[float, float, float]:
    """Algebraic least-squares circle fit. Returns (cx, cy, r)."""
    x = points[:, 0]; y = points[:, 1]
    A = np.column_stack([2 * x, 2 * y, np.ones_like(x)])
    b = x * x + y * y
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy, c = sol
    r = float(np.sqrt(max(c + cx * cx + cy * cy, 0.0)))
    return float(cx), float(cy), r


def _fit_disc_circle(mask: np.ndarray,
                     erode_iters: int = 2,
                     ransac_rounds: int = 3,
                     inlier_pad: float = 4.0) -> tuple[float, float, float]:
    """Robust circle fit:
       1. erode to drop halo,
       2. keep only the largest connected component (drops drop-shadow),
       3. LSQ-fit boundary points,
       4. iteratively reject outliers and refit (handles perspective bottom)."""
    cleaned = _erode(mask, iters=erode_iters)
    cleaned = _largest_component(cleaned)
    pts = _boundary_points(cleaned)
    if len(pts) < 16:
        raise RuntimeError("not enough boundary points for circle fit")
    cx, cy, r = _lsq_circle(pts)
    for _ in range(ransac_rounds):
        d = np.hypot(pts[:, 0] - cx, pts[:, 1] - cy)
        # Reject points whose residual is more than `inlier_pad` px from r,
        # then refit. Drop-shadow / perspective edge tend to lie outside r.
        keep = np.abs(d - r) <= inlier_pad
        if keep.sum() < 16 or keep.sum() == len(pts):
            break
        pts = pts[keep]
        cx, cy, r = _lsq_circle(pts)
    return cx, cy, r


def _centroid(mask: np.ndarray) -> tuple[float, float]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError("no foreground pixels found — check bg_thresh")
    return float(xs.mean()), float(ys.mean())


def _radius_via_rays(mask: np.ndarray,
                     cx: float, cy: float,
                     n_rays: int = 360) -> float:
    """March outward from (cx,cy) along n_rays directions; for each ray,
    find the last index that's still foreground. Return the MEDIAN —
    drop-shadows extend only on one side, so they're outliers."""
    H, W = mask.shape
    angles = np.linspace(0, 2 * np.pi, n_rays, endpoint=False)
    max_r  = int(min(cx, cy, W - cx, H - cy)) - 1
    # Step along each ray; since masks are dense, sample at 1px increments.
    rs = np.arange(1, max_r)
    radii = []
    for a in angles:
        dx, dy = np.cos(a), np.sin(a)
        xs = (cx + rs * dx).astype(int)
        ys = (cy + rs * dy).astype(int)
        ok = (xs >= 0) & (xs < W) & (ys >= 0) & (ys < H)
        xs, ys, rr = xs[ok], ys[ok], rs[ok]
        on = mask[ys, xs]
        # last foreground index along the ray
        if not on.any():
            continue
        last = np.where(on)[0].max()
        radii.append(rr[last])
    if not radii:
        raise RuntimeError("ray-march found no foreground")
    return float(np.median(radii))


# ── colorizing ───────────────────────────────────────────────────────────

def _rgb_to_hls(rgb: np.ndarray) -> np.ndarray:
    """Vectorized RGB[0..1] → HLS[0..1]. Shape preserved (..., 3)."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.maximum(np.maximum(r, g), b)
    mn = np.minimum(np.minimum(r, g), b)
    l  = (mx + mn) / 2.0
    d  = mx - mn
    s  = np.where(d == 0, 0.0,
                  np.where(l < 0.5, d / (mx + mn + 1e-12),
                           d / (2.0 - mx - mn + 1e-12)))
    h  = np.zeros_like(l)
    mask = d > 0
    rc = (mx - r) / np.where(d == 0, 1, d)
    gc = (mx - g) / np.where(d == 0, 1, d)
    bc = (mx - b) / np.where(d == 0, 1, d)
    h  = np.where((mx == r) & mask, (bc - gc),
         np.where((mx == g) & mask, 2.0 + (rc - bc),
         np.where((mx == b) & mask, 4.0 + (gc - rc), h)))
    h  = (h / 6.0) % 1.0
    return np.stack([h, l, s], axis=-1)


def _hls_to_rgb(hls: np.ndarray) -> np.ndarray:
    h, l, s = hls[..., 0], hls[..., 1], hls[..., 2]
    def _hue(t):
        t = t % 1.0
        out = np.where(t < 1/6, p + (q - p) * 6 * t,
              np.where(t < 0.5, q,
              np.where(t < 2/3, p + (q - p) * (2/3 - t) * 6, p)))
        return out
    q = np.where(l < 0.5, l * (1 + s), l + s - l * s)
    p = 2 * l - q
    r = _hue(h + 1/3); g = _hue(h); b = _hue(h - 1/3)
    return np.stack([r, g, b], axis=-1)


def colorize(rgba: np.ndarray, hue_deg: float,
             sat: float = 0.45,
             light_shift: float = 0.0,
             light_scale: float = 1.0,
             strength: float = 1.0) -> np.ndarray:
    """Recolor an RGBA disc by setting hue and target saturation,
    preserving original luminance detail.

    hue_deg:     target hue in degrees [0..360)
    sat:         target saturation [0..1] (0 = grey, ~0.4 = washed wood,
                 ~0.8 = vivid)
    light_shift: add to lightness [-0.5..0.5] — use to darken/lighten body
    light_scale: contrast multiplier around 0.5
    strength:    0.0 = no change (return original), 1.0 = full colorize.
                 Values in between blend, useful for subtle washes.
    """
    rgb = rgba[..., :3].astype(np.float32) / 255.0
    a   = rgba[..., 3:4]
    hls = _rgb_to_hls(rgb)

    h_target = (hue_deg % 360.0) / 360.0
    new = hls.copy()
    new[..., 0] = h_target
    # SET saturation rather than scaling — bodies near grey would otherwise
    # stay grey. We preserve a touch of original sat variation so highlights
    # don't go flat.
    new[..., 2] = np.clip(sat + (hls[..., 2] - hls[..., 2].mean()) * 0.5,
                           0.0, 1.0)
    if light_scale != 1.0:
        new[..., 1] = np.clip((new[..., 1] - 0.5) * light_scale + 0.5, 0, 1)
    if light_shift != 0.0:
        new[..., 1] = np.clip(new[..., 1] + light_shift, 0, 1)

    # Blend original ↔ new in HLS, then convert to RGB.
    s = float(np.clip(strength, 0.0, 1.0))
    blended = hls * (1 - s) + new * s
    # Hue is circular — for s<1 with replaced hue, the linear blend gives
    # an interpolated hue, which is fine for our use (no wrap issue here
    # because we always replace the whole hue channel).
    out = _hls_to_rgb(blended)
    out = np.clip(out * 255.0, 0, 255).astype(np.uint8)
    return np.concatenate([out, a], axis=-1)


# Named tint variants — pair these as the "two armies" on a board.
# `sat` is the target saturation level; `light_shift` darkens/lightens body.
TINTS: dict[str, dict] = {
    "ivory":   {"hue":  40, "sat": 0.18, "light_shift":  0.18},
    "bone":    {"hue":  35, "sat": 0.10, "light_shift":  0.22},
    "ebony":   {"hue":  25, "sat": 0.15, "light_shift": -0.32},
    "walnut":  {"hue":  22, "sat": 0.55, "light_shift": -0.10},
    "claret":  {"hue": 352, "sat": 0.55, "light_shift": -0.06},
    "forest":  {"hue": 150, "sat": 0.45, "light_shift": -0.08},
    "navy":    {"hue": 215, "sat": 0.55, "light_shift": -0.18},
    "gold":    {"hue":  42, "sat": 0.55, "light_shift":  0.02},
    "jade":    {"hue": 165, "sat": 0.40, "light_shift": -0.04},
}


# ── compositing ──────────────────────────────────────────────────────────

def _circular_alpha(size: int, radius: float, feather: float = 1.5) -> np.ndarray:
    """Anti-aliased disc alpha mask, [0..255] uint8."""
    yy, xx = np.mgrid[0:size, 0:size]
    cc = (size - 1) / 2.0
    d  = np.sqrt((xx - cc) ** 2 + (yy - cc) ** 2)
    # smoothstep over [radius-feather, radius]
    a = np.clip((radius - d) / max(feather, 1e-6), 0.0, 1.0)
    return (a * 255.0).astype(np.uint8)


def _recenter(mask: np.ndarray, cx: float, cy: float, r: float
              ) -> tuple[float, float]:
    """Recompute centroid using only foreground pixels inside a circle of
    1.05*r around (cx,cy) — strips drop shadow that biased the first pass."""
    H, W = mask.shape
    yy, xx = np.mgrid[0:H, 0:W]
    inside = ((xx - cx) ** 2 + (yy - cy) ** 2) <= (1.05 * r) ** 2
    keep = mask & inside
    ys, xs = np.where(keep)
    if len(xs) == 0:
        return cx, cy
    return float(xs.mean()), float(ys.mean())


def crop_disc(src_path: Path,
              out_path: Path,
              bg_thresh: int = 232,
              margin: float = 0.04,
              shrink: float = 0.985,
              feather: float = 1.5,
              out_size: int | None = 512,
              n_rays: int = 360,
              n_iter: int = 2) -> dict:
    """Detect the disc, return RGBA-on-transparent square PNG.

    margin: extra padding beyond the detected radius, as a fraction of r.
    shrink: pull radius slightly INSIDE the detected edge to avoid the
            faint background halo at the rim.
    out_size: if set, resample output to this square size; None keeps native.
    n_iter: extra recenter+ray-march passes after the initial centroid
            (drops drop-shadow bias).
    """
    img = Image.open(src_path).convert("RGB")
    rgb = np.asarray(img)
    mask = _foreground_mask(rgb, bg_thresh)
    cx, cy, r = _fit_disc_circle(mask)
    r = r * shrink

    # Square crop window centered on (cx,cy), padded by margin.
    pad = int(round(r * (1.0 + margin)))
    half = pad
    left   = int(round(cx)) - half
    top    = int(round(cy)) - half
    right  = left + 2 * half
    bottom = top  + 2 * half

    # If centroid is near an edge, expand the canvas with white before crop.
    H, W = rgb.shape[:2]
    pad_l = max(0, -left)
    pad_t = max(0, -top)
    pad_r = max(0, right  - W)
    pad_b = max(0, bottom - H)
    if any((pad_l, pad_t, pad_r, pad_b)):
        canvas = np.full((H + pad_t + pad_b, W + pad_l + pad_r, 3),
                         fill_value=255, dtype=np.uint8)
        canvas[pad_t:pad_t + H, pad_l:pad_l + W] = rgb
        rgb = canvas
        cx += pad_l; cy += pad_t
        left += pad_l; top += pad_t
        right += pad_l; bottom += pad_t

    crop = rgb[top:bottom, left:right]
    size = crop.shape[0]

    # Build alpha at native crop size for max edge fidelity.
    alpha = _circular_alpha(size, r, feather=feather)
    rgba  = np.dstack([crop, alpha])
    out   = Image.fromarray(rgba, mode="RGBA")

    if out_size and out_size != size:
        out = out.resize((out_size, out_size), Image.LANCZOS)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out.save(out_path, format="PNG", optimize=True)
    return {"src": str(src_path), "out": str(out_path),
            "center": (cx, cy), "radius": r, "crop_size": size}


# ── CLI ──────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--src",     type=Path, help="source PNG")
    ap.add_argument("--out",     type=Path, help="output PNG path")
    ap.add_argument("--preset",  choices=list(PRESETS), help="named preset")
    ap.add_argument("--all",     action="store_true", help="run every preset")
    ap.add_argument("--list",    action="store_true", help="list presets")
    ap.add_argument("--tint",    help="named tint or 'H,S,L' (e.g. ivory or 350,0.85,-0.05)")
    ap.add_argument("--list-tints", action="store_true")
    ap.add_argument("--variants", nargs="+",
                    help="emit colorized copies of preset/src as <name>-<tint>.png")
    ap.add_argument("--bg-thresh", type=int,   default=232)
    ap.add_argument("--margin",    type=float, default=0.04)
    ap.add_argument("--shrink",    type=float, default=0.985)
    ap.add_argument("--feather",   type=float, default=1.5)
    ap.add_argument("--size",      type=int,   default=512,
                    help="output square size in px (0 = native)")
    args = ap.parse_args()

    if args.list:
        for k, v in PRESETS.items():
            print(f"  {k:14s}  {v['description']}")
        return

    if args.list_tints:
        for k, v in TINTS.items():
            print(f"  {k:8s}  hue={v['hue']:>3}°  "
                  f"sat={v['sat']:.2f}  L{v['light_shift']:+.2f}")
        return

    def _resolve_tint(spec: str) -> dict:
        if spec in TINTS:
            return TINTS[spec]
        parts = spec.split(",")
        if len(parts) not in (2, 3):
            raise SystemExit(f"bad --tint spec: {spec}")
        h = float(parts[0])
        s = float(parts[1])
        l = float(parts[2]) if len(parts) == 3 else 0.0
        return {"hue": h, "sat_scale": s, "light_shift": l}

    def _apply_tint(out_path: Path, tint: dict) -> Path:
        rgba = np.asarray(Image.open(out_path).convert("RGBA"))
        tinted = colorize(rgba, tint["hue"],
                          tint.get("sat", 0.45),
                          tint.get("light_shift", 0.0),
                          tint.get("light_scale", 1.0),
                          tint.get("strength", 1.0))
        Image.fromarray(tinted, "RGBA").save(out_path, format="PNG", optimize=True)
        return out_path

    out_size = args.size if args.size > 0 else None
    common = dict(bg_thresh=args.bg_thresh, margin=args.margin,
                  shrink=args.shrink, feather=args.feather, out_size=out_size)

    if args.all:
        for name, cfg in PRESETS.items():
            out = BG_ASSETS / f"{name}.png"
            info = crop_disc(cfg["src"], out, **common)
            print(f"{name:14s} → {out.relative_to(REPO)}  "
                  f"r={info['radius']:.1f}  src={info['crop_size']}px")
        return

    if args.preset:
        cfg = PRESETS[args.preset]
        src = cfg["src"]
        out = args.out or (BG_ASSETS / f"{args.preset}.png")
    else:
        if not args.src or not args.out:
            ap.error("need --src and --out, or --preset, or --all")
        src, out = args.src, args.out

    info = crop_disc(src, out, **common)
    print(f"{src.name} → {out}  r={info['radius']:.1f}  "
          f"crop={info['crop_size']}px")

    if args.tint:
        _apply_tint(out, _resolve_tint(args.tint))
        print(f"  tinted → {out}")

    if args.variants:
        stem = out.stem
        parent = out.parent
        for tname in args.variants:
            tint = _resolve_tint(tname)
            variant_path = parent / f"{stem}-{tname}.png"
            # copy current crop and tint
            Image.open(out).save(variant_path)
            _apply_tint(variant_path, tint)
            print(f"  variant → {variant_path.relative_to(REPO)}")


if __name__ == "__main__":
    main()
