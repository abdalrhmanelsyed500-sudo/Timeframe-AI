import type { Motion, Transition } from "./vocab";

/**
 * Visual styles are versioned configuration objects, never bare strings.
 * They drive the prompt compiler, the motion engine and cinematic scoring.
 */
export interface StyleConfig {
  styleKey: string;
  version: number;
  name: string;
  description: string;
  colorPalette: string;
  lighting: string;
  contrast: string;
  cameraLanguage: string;
  compositionRules: string[];
  texture: string;
  grain: string;
  negativeRules: string[];
  motion: {
    allowed: Motion[];
    maxScale: number; // maximum zoom factor across a shot
    maxPanFraction: number; // maximum pan as a fraction of frame width
    maxRotationDeg: number;
  };
  transitions: {
    allowed: Transition[];
    defaultWithinScene: Transition;
    defaultBetweenScenes: Transition;
    defaultBetweenSections: Transition;
    durationMs: number;
  };
  promptRules: string[];
}

export const CINEMATIC_DOCUMENTARY: StyleConfig = {
  styleKey: "cinematic_documentary",
  version: 1,
  name: "Cinematic Documentary",
  description:
    "Realistic, restrained documentary cinematography with natural light, believable environments and controlled cinematic colour.",
  colorPalette: "muted naturalistic palette, desaturated shadows, warm practical highlights",
  lighting: "motivated natural lighting, soft directional key, gentle falloff, realistic ambient bounce",
  contrast: "controlled contrast, protected highlights, detail retained in shadows",
  cameraLanguage: "observational framing, restrained movement, eye-level or motivated angles",
  compositionRules: [
    "respect the rule of thirds unless a centred frame is dramatically motivated",
    "leave deliberate headroom and lead room",
    "use foreground elements for depth",
    "keep horizons level unless a canted angle is motivated",
  ],
  texture: "realistic materials, physically plausible surfaces, authentic wear and patina",
  grain: "subtle fine film grain",
  negativeRules: [
    "no text, captions, watermarks, logos or signatures",
    "no distorted or duplicated anatomy",
    "no modern anachronisms when a historical era is specified",
    "no cartoon, anime, 3d-render or video-game appearance",
    "no oversaturated HDR look, no lens flare spam",
    "no recognisable copyrighted characters, brands or protected visual identities",
  ],
  motion: {
    allowed: ["STATIC", "SLOW_ZOOM_IN", "SLOW_ZOOM_OUT", "PAN_LEFT", "PAN_RIGHT", "PUSH_IN", "PULL_OUT", "DRIFT_LEFT", "DRIFT_RIGHT"],
    maxScale: 1.12,
    maxPanFraction: 0.06,
    maxRotationDeg: 0,
  },
  transitions: {
    allowed: ["CUT", "FADE", "DIP_TO_BLACK", "CROSSFADE"],
    defaultWithinScene: "CUT",
    defaultBetweenScenes: "CROSSFADE",
    defaultBetweenSections: "DIP_TO_BLACK",
    durationMs: 500,
  },
  promptRules: [
    "photographic realism, shot on cinema camera",
    "physically accurate light transport",
    "documentary authenticity over stylised spectacle",
  ],
};

export const MINIMAL: StyleConfig = {
  styleKey: "minimal",
  version: 1,
  name: "Minimal",
  description: "Clean, graphic, low-clutter imagery with generous negative space and a restrained palette.",
  colorPalette: "restrained two-to-three tone palette, large flat fields, single accent colour",
  lighting: "even, soft, shadow-light illumination",
  contrast: "low to medium contrast, clean separation",
  cameraLanguage: "straight-on or top-down framing, geometric alignment",
  compositionRules: [
    "generous negative space",
    "strong single focal subject",
    "geometric alignment and symmetry",
    "avoid background clutter",
  ],
  texture: "smooth matte surfaces, minimal detail noise",
  grain: "none",
  negativeRules: [
    "no text, captions, watermarks, logos or signatures",
    "no busy or cluttered backgrounds",
    "no heavy textures or ornate detail",
    "no recognisable copyrighted characters, brands or protected visual identities",
  ],
  motion: {
    allowed: ["STATIC", "SLOW_ZOOM_IN", "DRIFT_LEFT", "DRIFT_RIGHT"],
    maxScale: 1.06,
    maxPanFraction: 0.03,
    maxRotationDeg: 0,
  },
  transitions: {
    allowed: ["CUT", "FADE", "CROSSFADE"],
    defaultWithinScene: "CUT",
    defaultBetweenScenes: "FADE",
    defaultBetweenSections: "FADE",
    durationMs: 400,
  },
  promptRules: ["clean graphic composition", "editorial minimalism", "precise and uncluttered"],
};

export const STYLES: Record<string, StyleConfig> = {
  [CINEMATIC_DOCUMENTARY.styleKey]: CINEMATIC_DOCUMENTARY,
  [MINIMAL.styleKey]: MINIMAL,
};

export const DEFAULT_STYLE_KEY = CINEMATIC_DOCUMENTARY.styleKey;

export function getStyle(styleKey: string): StyleConfig {
  return STYLES[styleKey] ?? CINEMATIC_DOCUMENTARY;
}

export function listStyles(): StyleConfig[] {
  return Object.values(STYLES);
}
