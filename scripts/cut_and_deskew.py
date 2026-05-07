#!/usr/bin/env python3
"""Cut + deskew in one pass from the original sheets.

For each source sheet we:
  1. detect row/column bands of card-vs-background pixels (existing logic);
  2. sample the **inter-card gap** to get a true background color
     (corners of cropped cards can land on full-bleed design);
  3. for each card region take a generous sub-crop, rotate around its
     center to align the card's major axis to vertical (PCA on the mask),
     then tight-crop with PAD.

Outputs replace plugins/cribbage/client/assets/cards/ with deskewed
versions of the 52 face cards + 9 back samples.
"""

import os
import sys
from pathlib import Path
import numpy as np
from PIL import Image

HOME = Path(os.path.expanduser("~"))
PROJECT = Path(__file__).resolve().parent.parent
OUT_DIR = PROJECT / "plugins" / "cribbage" / "client" / "assets" / "cards"

RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K"]
PAD = 6
SUB_MARGIN = 30   # extra margin around each card before rotation
COLOR_DIST = 30   # mask threshold


def find_bands(active: np.ndarray, min_gap: int = 8) -> list[tuple[int, int]]:
    bands = []
    in_band = False
    start = 0
    for i, a in enumerate(active):
        if a and not in_band:
            in_band = True; start = i
        elif not a and in_band:
            in_band = False; bands.append((start, i))
    if in_band:
        bands.append((start, len(active)))
    merged = []
    for s, e in bands:
        if merged and s - merged[-1][1] < min_gap:
            merged[-1] = (merged[-1][0], e)
        else:
            merged.append((s, e))
    return merged


def detect_bg(arr: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Background = median of the four sheet corners. Each sheet has a
    margin of pure background around the card grid, so corners are a
    reliable sample."""
    h, w, _ = arr.shape
    c = 12
    samples = np.concatenate([
        arr[:c, :c].reshape(-1, 3),
        arr[:c, -c:].reshape(-1, 3),
        arr[-c:, :c].reshape(-1, 3),
        arr[-c:, -c:].reshape(-1, 3),
    ])
    return np.median(samples, axis=0).astype(np.float32)


def card_mask(arr: np.ndarray, bg: np.ndarray) -> np.ndarray:
    return np.linalg.norm(arr.astype(np.float32) - bg, axis=2) > COLOR_DIST


def edge_angle_degrees(mask: np.ndarray) -> float:
    """Detect the card's tilt by line-fitting its top and bottom edges.
    More robust than PCA when card content is non-uniformly distributed
    (e.g. pip cards with content clustered at corners).

    Returns degrees, sign matched to PIL.rotate (positive = CCW correction
    will deskew a CW-tilted card).
    """
    h, w = mask.shape
    if w < 20 or h < 20:
        return 0.0
    has_any = mask.any(axis=0)
    if has_any.sum() < 20:
        return 0.0

    # Top edge: topmost masked row per column
    top = np.argmax(mask, axis=0).astype(float)
    # Bottom edge: distance from bottom of bottommost masked row per column
    flipped = np.flip(mask, axis=0)
    bot_from_bot = np.argmax(flipped, axis=0).astype(float)
    bot = (h - 1) - bot_from_bot

    xs = np.arange(w, dtype=float)
    valid = has_any
    # Trim 10% from each side (corners often curve / have rounded edges)
    trim = int(w * 0.10)
    valid = valid.copy()
    valid[:trim] = False
    valid[w - trim:] = False
    if valid.sum() < 20:
        return 0.0

    xv = xs[valid]
    tv = top[valid]
    bv = bot[valid]

    # Bin the columns into ~24 equal slices and take the median y per bin.
    # That suppresses point-level outliers (specks/dust above or below the
    # card edge) without removing the slope signal.
    def fit(y_vals: np.ndarray) -> float:
        n_bins = 24
        if len(xv) < n_bins * 3:
            slope, _ = np.polyfit(xv, y_vals, 1)
            return float(np.degrees(np.arctan(slope)))
        edges = np.linspace(xv[0], xv[-1] + 1, n_bins + 1)
        bin_x = []
        bin_y = []
        for i in range(n_bins):
            in_bin = (xv >= edges[i]) & (xv < edges[i + 1])
            if in_bin.sum() < 3:
                continue
            bin_x.append(xv[in_bin].mean())
            bin_y.append(np.median(y_vals[in_bin]))
        if len(bin_x) < 4:
            return 0.0
        slope, _ = np.polyfit(np.array(bin_x), np.array(bin_y), 1)
        return float(np.degrees(np.arctan(slope)))

    top_angle = fit(tv)
    bot_angle = fit(bv)
    return (top_angle + bot_angle) / 2.0


def cut_card(sheet_arr: np.ndarray, sheet_img: Image.Image,
             y0: int, y1: int, x0: int, x1: int, sheet_bg: np.ndarray):
    sh, sw, _ = sheet_arr.shape

    # Step 1: detect angle. Use the card's column range (x0..x1) but with
    # a vertical margin so the FULL top and bottom edges are visible (the
    # tight band already clips the highest/lowest tilted corners). We do
    # NOT extend horizontally — that would pull neighbor cards in.
    sh, sw, _ = sheet_arr.shape
    ay0 = max(0, y0 - SUB_MARGIN)
    ay1 = min(sh, y1 + SUB_MARGIN)
    angle_arr = sheet_arr[ay0:ay1, x0:x1]
    angle_mask = card_mask(angle_arr, sheet_bg)
    angle = edge_angle_degrees(angle_mask)

    # Step 2: take a generous sub-region for the actual rotation so corners
    # don't get clipped. This sub-region may contain neighbors but they
    # don't affect the angle (computed in step 1).
    sy0 = max(0, y0 - SUB_MARGIN)
    sy1 = min(sh, y1 + SUB_MARGIN)
    sx0 = max(0, x0 - SUB_MARGIN)
    sx1 = min(sw, x1 + SUB_MARGIN)
    fill = tuple(int(round(v)) for v in sheet_bg)
    sub_img = sheet_img.crop((sx0, sy0, sx1, sy1))
    rotated = sub_img.rotate(angle, resample=Image.BICUBIC, expand=True, fillcolor=fill)

    # Step 3: compute the upright card dimensions geometrically and crop
    # a centered window of exactly that size (plus PAD). For an axis-
    # aligned rectangle (w x h) rotated by |θ|, the bounding box is:
    #   bbox_w = w cos|θ| + h sin|θ|
    #   bbox_h = w sin|θ| + h cos|θ|
    # Inverting (with cos(2θ) ≠ 0):
    #   w = (bbox_w cos|θ| - bbox_h sin|θ|) / cos(2θ)
    #   h = (bbox_h cos|θ| - bbox_w sin|θ|) / cos(2θ)
    bbox_w = x1 - x0
    bbox_h = y1 - y0
    a = abs(np.radians(angle))
    cos_a = np.cos(a); sin_a = np.sin(a); cos_2a = np.cos(2 * a)
    if cos_2a < 1e-3:
        upright_w, upright_h = bbox_w, bbox_h
    else:
        upright_w = (bbox_w * cos_a - bbox_h * sin_a) / cos_2a
        upright_h = (bbox_h * cos_a - bbox_w * sin_a) / cos_2a
    target_w = max(1, int(round(upright_w)) + 2 * PAD)
    target_h = max(1, int(round(upright_h)) + 2 * PAD)
    rw, rh = rotated.size
    cx_r, cy_r = rw / 2.0, rh / 2.0
    rx0 = max(0, int(round(cx_r - target_w / 2)))
    ry0 = max(0, int(round(cy_r - target_h / 2)))
    rx1 = min(rw, rx0 + target_w)
    ry1 = min(rh, ry0 + target_h)
    return rotated.crop((rx0, ry0, rx1, ry1)), angle


def process_face_sheet(path: Path, suit: str):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img)
    # Faces use darkness mask (background is white, content includes paper)
    mask = arr.min(axis=2) <= 200
    bg = detect_bg(arr, mask)
    rows = find_bands(mask.sum(axis=1) >= 8)
    if len(rows) != 3:
        raise RuntimeError(f"{suit}: row-band count = {len(rows)}")

    rank_idx = 0
    for ri, (y0, y1) in enumerate(rows):
        strip = mask[y0:y1, :]
        cols = find_bands(strip.sum(axis=0) >= 8)
        for x0, x1 in cols:
            if rank_idx >= 13:
                raise RuntimeError(f"{suit}: too many cards in row {ri}")
            card, ang = cut_card(arr, img, y0, y1, x0, x1, bg)
            out = OUT_DIR / f"{suit}-{RANKS[rank_idx]}.jpg"
            card.save(out, "JPEG", quality=92)
            print(f"  {suit}-{RANKS[rank_idx]}: angle={ang:+.2f}°")
            rank_idx += 1
    if rank_idx != 13:
        raise RuntimeError(f"{suit}: got only {rank_idx} cards")


def process_backs_sheet(path: Path):
    img = Image.open(path).convert("RGB")
    arr = np.asarray(img)
    # Backs use saturation mask (background is gray, cards are saturated)
    diff = arr.max(axis=2).astype(int) - arr.min(axis=2).astype(int)
    mask = diff >= 25
    bg = detect_bg(arr, mask)
    rows = find_bands(mask.sum(axis=1) >= 30)
    if len(rows) != 3:
        raise RuntimeError(f"backs: row-band count = {len(rows)}")

    idx = 0
    for ri, (y0, y1) in enumerate(rows):
        strip = mask[y0:y1, :]
        cols = find_bands(strip.sum(axis=0) >= 30)
        for x0, x1 in cols:
            idx += 1
            card, ang = cut_card(arr, img, y0, y1, x0, x1, bg)
            out = OUT_DIR / f"back-{idx}.jpg"
            card.save(out, "JPEG", quality=92)
            print(f"  back-{idx}: angle={ang:+.2f}°")
    if idx != 9:
        raise RuntimeError(f"backs: got only {idx}")


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    # Clear old cards/backs (we recreate everything)
    for f in OUT_DIR.glob("*.jpg"):
        f.unlink()

    sheets = [
        (HOME / "Screenshots" / "playing_cards_1.jpg", "clubs"),
        (HOME / "Screenshots" / "playing_cards_2.jpg", "diamonds"),
        (HOME / "Screenshots" / "playing_cards_3.jpg", "hearts"),
        (HOME / "Screenshots" / "playing_cards_4.jpg", "spades"),
    ]
    for path, suit in sheets:
        if not path.exists():
            print(f"missing: {path}", file=sys.stderr); sys.exit(1)
        print(f"cut+deskew {path.name} -> {suit}")
        process_face_sheet(path, suit)

    backs = HOME / "Screenshots" / "playing_card_backs_1.jpg"
    if backs.exists():
        print(f"cut+deskew {backs.name} -> backs")
        process_backs_sheet(backs)

    n = len(list(OUT_DIR.glob("*.jpg")))
    print(f"\nwrote {n} images to {OUT_DIR}")


if __name__ == "__main__":
    main()
