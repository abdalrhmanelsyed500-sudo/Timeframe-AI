import { apiHandler } from "@/lib/api/handler";
import { listStyles } from "@/lib/domain/styles";
import { PROFILE_LIST } from "@/lib/render/profiles";
import { ASPECT_PRESETS } from "@/lib/services/projects";

export const GET = apiHandler({ auth: false, rateLimit: "read" }, async () => ({
  styles: listStyles().map((s) => ({
    styleKey: s.styleKey,
    version: s.version,
    name: s.name,
    description: s.description,
    colorPalette: s.colorPalette,
    lighting: s.lighting,
  })),
  renderProfiles: PROFILE_LIST,
  aspectRatios: Object.entries(ASPECT_PRESETS).map(([key, v]) => ({ key, ...v })),
}));
