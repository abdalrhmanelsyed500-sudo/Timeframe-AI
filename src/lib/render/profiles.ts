export interface RenderProfile {
  key: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  crf: number;
  preset: string;
  audioBitrate: string;
  description: string;
}

export const RENDER_PROFILES: Record<string, RenderProfile> = {
  PREVIEW: {
    key: "PREVIEW",
    name: "Preview",
    width: 960,
    height: 540,
    fps: 30,
    crf: 28,
    preset: "veryfast",
    audioBitrate: "128k",
    description: "Fast, low-resolution pass for reviewing the edit.",
  },
  FULL_HD: {
    key: "FULL_HD",
    name: "Full HD",
    width: 1920,
    height: 1080,
    fps: 30,
    crf: 20,
    preset: "medium",
    audioBitrate: "192k",
    description: "Standard 1080p delivery master.",
  },
  VERTICAL: {
    key: "VERTICAL",
    name: "Vertical",
    width: 1080,
    height: 1920,
    fps: 30,
    crf: 21,
    preset: "medium",
    audioBitrate: "192k",
    description: "9:16 for Shorts, Reels and TikTok.",
  },
  SQUARE: {
    key: "SQUARE",
    name: "Square",
    width: 1080,
    height: 1080,
    fps: 30,
    crf: 21,
    preset: "medium",
    audioBitrate: "192k",
    description: "1:1 for feed placements.",
  },
};

export function getProfile(key: string): RenderProfile {
  return RENDER_PROFILES[key] ?? RENDER_PROFILES.FULL_HD;
}

export const PROFILE_LIST = Object.values(RENDER_PROFILES);
