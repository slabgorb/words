/**
 * Dice appearance — driven by genre. Lives in its own file so DiceScene can
 * stay component-only (react-refresh requires component-only modules).
 */
export interface DiceTheme {
  /** Die body color */
  dieColor: string;
  /** Face number color */
  labelColor: string;
  /** Font URL for face numbers (.ttf only — troika doesn't support .woff2) */
  labelFont?: string;
  /** Surface roughness (0 = glossy, 1 = matte) */
  roughness?: number;
  /** Metalness (0 = plastic, 1 = chrome) */
  metalness?: number;
  /** Normal map URL for surface detail (scratches, pitting, wear) */
  normalMap?: string;
  /** Normal map intensity (default 1.0) */
  normalScale?: number;
}

export const DEFAULT_DICE_THEME: DiceTheme = {
  dieColor: "#e8e0d0", // ivory
  labelColor: "#1a1a1a", // near-black
  roughness: 0.3,
  metalness: 0.1,
  normalMap: "/shared/dice-assets/scratched-plastic-normal.jpg",
  normalScale: 0.15,
};

export const OBSIDIAN_DICE_THEME: DiceTheme = {
  dieColor: "#1c1c1f",
  labelColor: "#f4ead4",
  roughness: 0.45,
  metalness: 0.05,
  normalMap: "/shared/dice-assets/scratched-plastic-normal.jpg",
  normalScale: 0.2,
};

export const THEME_PRESETS: Record<string, DiceTheme> = {
  default: DEFAULT_DICE_THEME,
  ivory: DEFAULT_DICE_THEME,
  obsidian: OBSIDIAN_DICE_THEME,
};
