import { cleanText } from "@/lib/security/sanitize";
import { contentHash } from "@/lib/core/hash";
import type { StyleConfig } from "@/lib/domain/styles";
import type { Camera, Lens, VisualIntent } from "@/lib/domain/vocab";
import { PROMPT_VERSIONS } from "@/lib/ai/prompts";

/**
 * prompt_compiler.v1
 *
 * Builds a CANONICAL prompt in a fixed section order. The canonical form is
 * provider-independent; provider adaptation happens separately at call time.
 */

export interface EntityRef {
  name: string;
  appearance: string;
  continuity: string;
}

export interface VisualSpecification {
  shotId: string;
  visualIntent: VisualIntent;
  subject: string;
  action: string;
  environment: string;
  era: string;
  entities: EntityRef[];
  composition: string;
  camera: Camera;
  lens: Lens;
  lighting: string;
  color: string;
  atmosphere: string;
  depthOfField: string;
  styleKey: string;
  styleVersion: number;
  negativeConstraints: string[];
  aspectRatio: string;
}

const INTENT_FRAMING: Record<VisualIntent, string> = {
  ESTABLISHING: "expansive establishing frame revealing the whole environment",
  WIDE: "wide frame with the subject placed within its surroundings",
  MEDIUM: "medium frame, subject from roughly the waist up",
  CLOSE_UP: "close framing isolating the subject",
  EXTREME_CLOSE_UP: "extreme close framing on a single defining detail",
  OVER_SHOULDER: "over-the-shoulder framing with a soft foreground silhouette",
  TOP_DOWN: "directly overhead top-down framing",
  LOW_ANGLE: "low camera position looking upward, subject made imposing",
  HIGH_ANGLE: "elevated camera looking down across the scene",
  DETAIL: "tight detail frame emphasising texture and material",
  ENVIRONMENTAL: "environmental frame where place is the true subject",
  ABSTRACT: "abstract, non-literal visual metaphor",
  ARCHIVAL: "archival-styled documentary frame with period-authentic texture",
  MAP: "clean cartographic illustration of the geography, no lettering",
  DIAGRAM: "clear explanatory diagram using shapes and arrows only, no lettering",
  OBJECT_FOCUS: "single object presented as the hero of the frame",
  CHARACTER_FOCUS: "human subject as the clear focal point",
};

const DOF_BY_LENS: Record<Lens, string> = {
  "24mm": "deep focus, foreground to horizon sharp",
  "28mm": "deep focus with mild foreground separation",
  "35mm": "natural depth, gentle background falloff",
  "50mm": "natural depth of field, background softly separated",
  "85mm": "shallow depth of field, background rendered soft",
  "100mm": "very shallow depth of field, compressed planes",
  "135mm": "extremely shallow focus, strong compression",
};

export function buildVisualSpecification(params: {
  shotId: string;
  visualIntent: VisualIntent;
  subject: string;
  action: string;
  environment: string;
  era: string;
  composition: string;
  camera: Camera;
  lens: Lens;
  lighting: string;
  color: string;
  atmosphere: string;
  entities: EntityRef[];
  style: StyleConfig;
  aspectRatio: string;
  bibleNegativeRules?: string[];
}): VisualSpecification {
  return {
    shotId: params.shotId,
    visualIntent: params.visualIntent,
    subject: cleanText(params.subject, 300),
    action: cleanText(params.action, 300),
    environment: cleanText(params.environment, 300),
    era: cleanText(params.era, 120),
    entities: params.entities.slice(0, 4).map((e) => ({
      name: cleanText(e.name, 80),
      appearance: cleanText(e.appearance, 300),
      continuity: cleanText(e.continuity, 300),
    })),
    composition: cleanText(params.composition, 300),
    camera: params.camera,
    lens: params.lens,
    lighting: cleanText(params.lighting, 200) || params.style.lighting,
    color: cleanText(params.color, 200) || params.style.colorPalette,
    atmosphere: cleanText(params.atmosphere, 200),
    depthOfField: DOF_BY_LENS[params.lens],
    styleKey: params.style.styleKey,
    styleVersion: params.style.version,
    negativeConstraints: [...new Set([...params.style.negativeRules, ...(params.bibleNegativeRules ?? [])])].slice(0, 20),
    aspectRatio: params.aspectRatio,
  };
}

export interface CompiledPrompt {
  promptVersion: string;
  canonical: string;
  negative: string;
  hash: string;
}

/** Canonical section order — do not reorder without a new compiler version. */
export function compilePrompt(spec: VisualSpecification, style: StyleConfig): CompiledPrompt {
  const sections: [string, string][] = [];

  sections.push(["SUBJECT", spec.subject || "the narrative subject"]);
  if (spec.action) sections.push(["ACTION", spec.action]);
  sections.push(["ENVIRONMENT", spec.environment || "an environment implied by the narration"]);
  if (spec.era) sections.push(["ERA", `${spec.era}, period-accurate detail`]);

  if (spec.entities.length) {
    const continuity = spec.entities
      .map((e) => [e.name, e.appearance, e.continuity].filter(Boolean).join(" — "))
      .join(" | ");
    sections.push(["CONTINUITY", continuity]);
  }

  sections.push([
    "COMPOSITION",
    [INTENT_FRAMING[spec.visualIntent], spec.composition, ...style.compositionRules.slice(0, 2)]
      .filter(Boolean)
      .join(", "),
  ]);
  sections.push(["CAMERA", `${spec.camera.toLowerCase().replace(/_/g, " ")}, ${style.cameraLanguage}`]);
  sections.push(["LENS", `${spec.lens} lens, ${spec.depthOfField}`]);
  sections.push(["LIGHTING", spec.lighting]);
  sections.push(["COLOR", `${spec.color}, ${style.contrast}`]);
  if (spec.atmosphere) sections.push(["ATMOSPHERE", spec.atmosphere]);
  sections.push(["MATERIALS", style.texture]);
  sections.push(["STYLE", `${style.name}: ${style.description} ${style.promptRules.join(", ")}`]);
  sections.push(["QUALITY", `high fidelity, sharp where intended, ${style.grain || "clean"}, aspect ratio ${spec.aspectRatio}`]);

  const canonical = sections.map(([k, v]) => `${k}: ${cleanText(v, 600)}`).join("\n");
  const negative = spec.negativeConstraints.join(", ");

  return {
    promptVersion: PROMPT_VERSIONS.compiler,
    canonical,
    negative,
    hash: contentHash({ canonical, negative, v: PROMPT_VERSIONS.compiler }),
  };
}
