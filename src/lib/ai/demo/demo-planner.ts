import { stableInt, stablePick } from "@/lib/core/hash";
import type { AiStoryPlan, AiVisualBible, AiSection, AiScene, AiShot } from "@/lib/story/schema";
import type { VisualIntent } from "@/lib/domain/vocab";

/**
 * DETERMINISTIC DEMO PLANNER — NOT AN AI MODEL.
 *
 * A real linguistic heuristic engine (keyword salience, narrative position,
 * topic-shift detection, pacing analysis) that produces a genuine, content-derived
 * story plan without any provider call. Output is always labelled as demo.
 *
 * It is NOT "one image per sentence": segments are grouped into scenes by topic
 * shift and grouped into shots by narrative/visual logic, so shot count varies
 * with the actual content.
 */

export interface PlannerSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export interface PlannerInput {
  segments: PlannerSegment[];
  audioDurationMs: number;
  styleKey: string;
  projectName: string;
}

const STOPWORDS = new Set(
  ("the a an and or but of to in on at for with from by as is are was were be been being it its this that these those " +
    "we you they he she i our your their his her not no so if then than there here what which who whom how when where why " +
    "will would can could should may might must have has had do does did done about into over under again more most other " +
    "some such only own same too very just also which while during between within after before").split(" "),
);

const TIME_MARKERS = /\b(in|by|during|after|before|since|until)\s+(the\s+)?(\d{3,4}s?|\d{1,2}(st|nd|rd|th)\s+century|early|late|mid)\b/i;
const PLACE_HINT = /\b(city|cities|village|desert|mountain|river|ocean|sea|forest|island|valley|coast|street|road|temple|palace|castle|fortress|laboratory|factory|station|harbour|harbor|field|plain|canyon|glacier|cave|region|country|empire|kingdom|continent)\b/i;
const OBJECT_HINT = /\b(machine|engine|device|instrument|tool|weapon|ship|train|aircraft|telescope|microscope|manuscript|document|map|coin|statue|artifact|artefact|sample|specimen|reactor|satellite|computer|circuit)\b/i;
const ABSTRACT_HINT = /\b(idea|concept|theory|principle|belief|meaning|question|possibility|consequence|risk|future|memory|silence|change|truth|freedom|power|time|scale|infinity|probability)\b/i;
const DATA_HINT = /\b(percent|percentage|million|billion|thousand|ratio|average|rate|measure|data|statistic|number|figure|growth|decline)\b/i;
const CONFLICT_HINT = /\b(war|battle|attack|siege|revolt|collapse|crisis|disaster|struggle|conflict|defeat|victory|escape|storm|fire|flood|earthquake)\b/i;
const PERSON_HINT = /\b(he|she|they|his|her|their|man|woman|people|worker|soldier|scientist|engineer|farmer|king|queen|leader|child|children|crowd|family)\b/i;

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function keywords(text: string, limit = 6): string[] {
  const freq = new Map<string, number>();
  for (const w of words(text)) freq.set(w, (freq.get(w) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/** Proper nouns are strong entity candidates. */
function properNouns(text: string): string[] {
  const out = new Set<string>();
  const matches = text.match(/\b([A-Z][a-z]{2,})(\s+[A-Z][a-z]{2,})*/g) ?? [];
  for (const m of matches) {
    const first = m.split(/\s+/)[0].toLowerCase();
    if (STOPWORDS.has(first)) continue;
    out.add(m.trim());
  }
  return [...out];
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function chooseIntent(text: string, positionInScene: number, sceneShotCount: number, seed: string): VisualIntent {
  if (positionInScene === 0 && sceneShotCount > 1) return "ESTABLISHING";
  if (DATA_HINT.test(text)) return stablePick(seed + ":data", ["DIAGRAM", "ABSTRACT"] as const);
  if (TIME_MARKERS.test(text) && PLACE_HINT.test(text)) return "MAP";
  if (CONFLICT_HINT.test(text)) return stablePick(seed + ":conf", ["WIDE", "MEDIUM", "LOW_ANGLE"] as const);
  if (OBJECT_HINT.test(text)) return stablePick(seed + ":obj", ["OBJECT_FOCUS", "DETAIL", "EXTREME_CLOSE_UP"] as const);
  if (PERSON_HINT.test(text)) return stablePick(seed + ":per", ["CHARACTER_FOCUS", "CLOSE_UP", "MEDIUM"] as const);
  if (PLACE_HINT.test(text)) return stablePick(seed + ":pl", ["ENVIRONMENTAL", "WIDE", "HIGH_ANGLE"] as const);
  if (ABSTRACT_HINT.test(text)) return "ABSTRACT";
  return stablePick(seed + ":gen", ["MEDIUM", "WIDE", "DETAIL", "ENVIRONMENTAL"] as const);
}

const LENS_BY_INTENT: Partial<Record<VisualIntent, string>> = {
  ESTABLISHING: "24mm",
  WIDE: "28mm",
  ENVIRONMENTAL: "35mm",
  MEDIUM: "50mm",
  CHARACTER_FOCUS: "85mm",
  CLOSE_UP: "85mm",
  EXTREME_CLOSE_UP: "100mm",
  DETAIL: "100mm",
  OBJECT_FOCUS: "100mm",
  MAP: "50mm",
  DIAGRAM: "50mm",
  ABSTRACT: "35mm",
  ARCHIVAL: "35mm",
  TOP_DOWN: "35mm",
  LOW_ANGLE: "28mm",
  HIGH_ANGLE: "35mm",
  OVER_SHOULDER: "50mm",
};

const CAMERA_BY_INTENT: Partial<Record<VisualIntent, string>> = {
  ESTABLISHING: "STATIC",
  WIDE: "PAN_RIGHT",
  ENVIRONMENTAL: "TRACKING",
  MEDIUM: "STATIC",
  CLOSE_UP: "DOLLY_IN",
  EXTREME_CLOSE_UP: "STATIC",
  DETAIL: "STATIC",
  OBJECT_FOCUS: "ORBIT",
  CHARACTER_FOCUS: "STATIC",
  MAP: "TILT_DOWN",
  DIAGRAM: "STATIC",
  ABSTRACT: "DOLLY_OUT",
  LOW_ANGLE: "TILT_UP",
  HIGH_ANGLE: "TILT_DOWN",
  TOP_DOWN: "STATIC",
};

/**
 * Target shot length adapts to pacing. Dense, fast narration gets shorter shots;
 * reflective passages hold longer. This is what makes visual density dynamic.
 */
function targetShotMs(wordsPerMinute: number, tone: string): number {
  let base = 4200;
  if (wordsPerMinute > 175) base = 3200;
  else if (wordsPerMinute > 150) base = 3700;
  else if (wordsPerMinute < 110) base = 5600;
  else if (wordsPerMinute < 130) base = 4900;
  if (tone === "URGENT" || tone === "TENSE") base -= 700;
  if (tone === "REFLECTIVE" || tone === "SOMBRE") base += 700;
  return Math.max(2200, Math.min(8000, base));
}

function detectTone(text: string): string {
  if (CONFLICT_HINT.test(text)) return "TENSE";
  if (/\b(hope|breakthrough|discovery|triumph|success|achieved|solved)\b/i.test(text)) return "HOPEFUL";
  if (/\b(death|loss|famine|grief|ruin|decline|forgotten|abandoned)\b/i.test(text)) return "SOMBRE";
  if (/\b(vast|infinite|cosmos|universe|wonder|extraordinary|remarkable|immense)\b/i.test(text)) return "WONDROUS";
  if (/\b(must|urgent|rapidly|immediately|racing|before it)\b/i.test(text)) return "URGENT";
  if (/\b(remember|reflect|legacy|meant|question|consider)\b/i.test(text)) return "REFLECTIVE";
  return "NEUTRAL";
}

/** Group segments into scenes at topic shifts, respecting min/max scene length. */
function buildScenes(segments: PlannerSegment[]): PlannerSegment[][] {
  const MIN_SCENE_MS = 12_000;
  const MAX_SCENE_MS = 70_000;
  const groups: PlannerSegment[][] = [];
  let current: PlannerSegment[] = [];
  let currentKw = new Set<string>();

  for (const seg of segments) {
    const kw = new Set(words(seg.text));
    if (current.length === 0) {
      current = [seg];
      currentKw = kw;
      continue;
    }
    const spanMs = seg.endMs - current[0].startMs;
    const similarity = jaccard(currentKw, kw);
    const gapMs = seg.startMs - current[current.length - 1].endMs;
    const shift = similarity < 0.06 || gapMs > 1500 || TIME_MARKERS.test(seg.text);
    if ((shift && spanMs >= MIN_SCENE_MS) || spanMs >= MAX_SCENE_MS) {
      groups.push(current);
      current = [seg];
      currentKw = kw;
    } else {
      current.push(seg);
      for (const w of kw) currentKw.add(w);
    }
  }
  if (current.length) groups.push(current);
  return groups;
}

/** Group scenes into sections by narrative position and count. */
function buildSections(scenes: PlannerSegment[][][], totalMs: number): { title: string; purpose: string; scenes: PlannerSegment[][] }[] {
  const flat = scenes.flat();
  const targetSections = Math.max(3, Math.min(9, Math.round(totalMs / 120_000) + 2));
  const per = Math.max(1, Math.ceil(flat.length / targetSections));
  const out: { title: string; purpose: string; scenes: PlannerSegment[][] }[] = [];
  for (let i = 0; i < flat.length; i += per) {
    const chunk = flat.slice(i, i + per);
    const index = out.length;
    const isFirst = i === 0;
    const isLast = i + per >= flat.length;
    const text = chunk.flat().map((s) => s.text).join(" ");
    const kws = keywords(text, 3);
    const title = isFirst
      ? "Introduction"
      : isLast
        ? "Conclusion"
        : titleCase(kws.slice(0, 2).join(" ")) || `Part ${index + 1}`;
    const purpose = isFirst
      ? "Establish the subject and draw the viewer in."
      : isLast
        ? "Resolve the narrative and leave the viewer with the central idea."
        : `Develop the narrative around ${kws.join(", ") || "the subject"}.`;
    out.push({ title, purpose, scenes: chunk });
  }
  return out;
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase()).trim();
}

/** Split a scene's segments into shots using target duration + sentence boundaries. */
function buildShots(sceneSegments: PlannerSegment[], tone: string, seed: string): { startMs: number; endMs: number; text: string }[] {
  const sceneStart = sceneSegments[0].startMs;
  const sceneEnd = sceneSegments[sceneSegments.length - 1].endMs;
  const totalWords = sceneSegments.reduce((a, s) => a + s.text.split(/\s+/).length, 0);
  const minutes = Math.max(0.05, (sceneEnd - sceneStart) / 60_000);
  const wpm = totalWords / minutes;
  const target = targetShotMs(wpm, tone);

  const shots: { startMs: number; endMs: number; text: string }[] = [];
  let bucket: PlannerSegment[] = [];
  for (const seg of sceneSegments) {
    bucket.push(seg);
    const span = seg.endMs - bucket[0].startMs;
    const endsSentence = /[.!?]"?$/.test(seg.text.trim());
    if (span >= target && (endsSentence || span >= target * 1.6)) {
      shots.push(flush(bucket));
      bucket = [];
    }
  }
  if (bucket.length) {
    const last = flush(bucket);
    const prev = shots[shots.length - 1];
    // Avoid orphan micro-shots: merge anything under 1.2s into the previous shot.
    if (prev && last.endMs - last.startMs < 1200) {
      prev.endMs = last.endMs;
      prev.text = `${prev.text} ${last.text}`.trim();
    } else shots.push(last);
  }
  if (shots.length === 0) shots.push({ startMs: sceneStart, endMs: sceneEnd, text: sceneSegments.map((s) => s.text).join(" ") });

  // Close gaps so the scene is contiguous.
  for (let i = 0; i < shots.length; i++) {
    if (i === 0) shots[i].startMs = sceneStart;
    else shots[i].startMs = shots[i - 1].endMs;
    if (i === shots.length - 1) shots[i].endMs = sceneEnd;
  }
  void seed;
  return shots.filter((s) => s.endMs > s.startMs);
}

function flush(bucket: PlannerSegment[]): { startMs: number; endMs: number; text: string } {
  return {
    startMs: bucket[0].startMs,
    endMs: bucket[bucket.length - 1].endMs,
    text: bucket.map((s) => s.text).join(" ").trim(),
  };
}

export function planStory(input: PlannerInput): AiStoryPlan {
  const segments = input.segments;
  const sceneGroups = buildScenes(segments);
  const sections = buildSections([sceneGroups], input.audioDurationMs);
  const allText = segments.map((s) => s.text).join(" ");
  const globalNouns = properNouns(allText);

  const aiSections: AiSection[] = sections.map((sec, si) => {
    const aiScenes: AiScene[] = sec.scenes.map((sceneSegs, ci) => {
      const sceneText = sceneSegs.map((s) => s.text).join(" ");
      const tone = detectTone(sceneText);
      const kws = keywords(sceneText, 5);
      const nouns = properNouns(sceneText);
      const seedBase = `${input.projectName}:${si}:${ci}`;
      const shotSpans = buildShots(sceneSegs, tone, seedBase);
      const location = (PLACE_HINT.test(sceneText) ? nouns[0] : undefined) ?? (kws[0] ? titleCase(kws[0]) : "");
      const eraMatch = /\b(1[0-9]{3}|20[0-9]{2})s?\b/.exec(sceneText);
      const wpm =
        sceneText.split(/\s+/).length /
        Math.max(0.05, (sceneSegs[sceneSegs.length - 1].endMs - sceneSegs[0].startMs) / 60_000);

      const shots: AiShot[] = shotSpans.map((span, shi) => {
        const seed = `${seedBase}:${shi}`;
        const intent = chooseIntent(span.text, shi, shotSpans.length, seed);
        const shotKws = keywords(span.text, 4);
        const shotNouns = properNouns(span.text);
        return {
          startMs: span.startMs,
          endMs: span.endMs,
          narrationText: span.text,
          visualIntent: intent,
          subject: shotNouns[0] ?? titleCase(shotKws[0] ?? kws[0] ?? "the subject"),
          action: shotKws.slice(1, 3).join(" and ") || "held in quiet observation",
          environment: location || titleCase(kws[1] ?? "an evocative setting"),
          composition: intent === "ESTABLISHING" ? "wide balanced frame with deep foreground" : "subject on a third, clean negative space",
          camera: CAMERA_BY_INTENT[intent] ?? "STATIC",
          lens: LENS_BY_INTENT[intent] ?? "35mm",
          lighting: tone === "SOMBRE" ? "low-key overcast light" : tone === "HOPEFUL" ? "warm low-angle sunlight" : "soft naturalistic daylight",
          color: tone === "TENSE" ? "cool desaturated palette" : "muted naturalistic palette",
          atmosphere: tone === "WONDROUS" ? "vast, still, awe-inducing" : tone === "TENSE" ? "charged and uneasy" : "calm and observational",
          entities: [...new Set([...shotNouns.slice(0, 2), ...(globalNouns.includes(shotNouns[0]) ? [] : [])])],
          transition: shi === 0 ? (ci === 0 ? "DIP_TO_BLACK" : "CROSSFADE") : "CUT",
        };
      });

      return {
        title: titleCase(kws.slice(0, 3).join(" ")) || `Scene ${ci + 1}`,
        purpose: `Convey ${kws.slice(0, 3).join(", ") || "the narrative beat"} with a coherent visual run.`,
        location,
        era: eraMatch ? eraMatch[0] : "",
        tone,
        pacing: wpm > 165 ? "FAST" : wpm < 120 ? "SLOW" : "MEDIUM",
        visualStrategy:
          shots.length > 3
            ? "Open wide to establish, then move progressively closer as the idea sharpens."
            : "Hold a small number of strong frames and let the narration carry the beat.",
        startMs: sceneSegs[0].startMs,
        endMs: sceneSegs[sceneSegs.length - 1].endMs,
        shots,
      };
    });

    return {
      title: sec.title,
      purpose: sec.purpose,
      startMs: aiScenes[0].startMs,
      endMs: aiScenes[aiScenes.length - 1].endMs,
      scenes: aiScenes,
    };
  });

  return {
    summary: `A ${Math.round(input.audioDurationMs / 60000)}-minute narrative in ${aiSections.length} sections covering ${keywords(allText, 6).join(", ")}.`,
    sections: aiSections,
  };
}

export function planVisualBible(input: {
  storyText: string;
  styleKey: string;
  entityNames: string[];
  eras: string[];
  locations: string[];
}): AiVisualBible {
  const kws = keywords(input.storyText, 10);
  const era = input.eras[0] ?? "contemporary";
  const entities = [...new Set(input.entityNames)].slice(0, 40).map((name) => {
    const type = PLACE_HINT.test(name) || input.locations.includes(name) ? "LOCATION" : /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name) ? "CHARACTER" : "OBJECT";
    const seed = stableInt(name);
    return {
      type,
      name,
      description: `${name} as referenced throughout the narration.`,
      appearance:
        type === "CHARACTER"
          ? `Consistent build and dress appropriate to ${era}; recognisable silhouette maintained across every shot.`
          : type === "LOCATION"
            ? `Consistent geography, architecture and weather character across every appearance.`
            : `Consistent scale, material and wear across every appearance.`,
      visualAttributes: {
        palette: `hsl(${seed % 360} 30% 45%) dominant`,
        scale: type === "LOCATION" ? "environmental" : "human-scale",
      },
      continuityAttributes: {
        anchor: `Always depict ${name} with the same defining feature established on first appearance.`,
      },
    };
  });

  return {
    world: `A grounded world centred on ${kws.slice(0, 4).join(", ")}.`,
    era,
    geography: input.locations.slice(0, 6).join("; ") || "Locations implied by the narration.",
    locations: input.locations.slice(0, 12),
    architecture: `Building forms and materials consistent with ${era}.`,
    cinematography: "Observational documentary framing with restrained, motivated movement.",
    lighting: "Naturalistic, motivated light sources; soft key with realistic falloff.",
    color: "Muted naturalistic palette with a single consistent accent across the film.",
    atmosphere: "Authentic, grounded, atmospheric depth via haze and layered foregrounds.",
    style: input.styleKey,
    continuityRules: [
      "Entities keep identical defining features across every shot.",
      "Time of day progresses logically within a scene.",
      "Weather and season remain consistent within a location.",
      "Camera height and lens language stay consistent within a scene.",
    ],
    negativeRules: [
      "No on-image text, captions, watermarks or logos.",
      "No anachronistic objects for the stated era.",
      "No distorted anatomy or duplicated limbs.",
      "No copyrighted characters or protected visual identities.",
    ],
    entities,
  };
}
