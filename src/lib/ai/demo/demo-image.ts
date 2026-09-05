import sharp from "sharp";
import { stableInt } from "@/lib/core/hash";
import type { ImageProvider, ImageRequest, ImageResponse } from "@/lib/ai/types";

/**
 * DEMO IMAGE PROVIDER — NOT AN AI MODEL.
 *
 * Produces a deterministic, real PNG (composed procedurally with sharp) so the
 * full pipeline — validation, storage, thumbnails, timeline, FFmpeg render —
 * can be exercised without provider credentials.
 *
 * Every image it returns is flagged isMock: true, stored with is_mock = true,
 * and rendered with a visible "DEMO" watermark. It must never be presented as
 * real generative output.
 */
export class DemoImageProvider implements ImageProvider {
  readonly id = "demo";

  async generateImage(req: ImageRequest): Promise<ImageResponse> {
    const seed = req.seed ?? req.prompt;
    const h = stableInt(seed);
    const hue = h % 360;
    const hue2 = (hue + 25 + (h >> 8) % 60) % 360;
    const width = req.width;
    const height = req.height;

    // Deterministic procedural composition: gradient sky, horizon band,
    // layered silhouettes and a vignette — visually varied per shot seed.
    const horizon = Math.round(height * (0.45 + ((h >> 3) % 20) / 100));
    const sun = {
      x: Math.round(width * (0.2 + ((h >> 5) % 60) / 100)),
      y: Math.round(horizon * (0.35 + ((h >> 7) % 40) / 100)),
      r: Math.round(Math.min(width, height) * (0.04 + ((h >> 9) % 6) / 100)),
    };
    const layers = 3 + (h % 3);
    let silhouettes = "";
    for (let i = 0; i < layers; i++) {
      const li = stableInt(`${seed}:layer:${i}`);
      const base = horizon + (i * (height - horizon)) / layers;
      const amp = (height - horizon) * 0.18 * (1 - i / (layers + 1));
      const pts: string[] = [`0,${height}`];
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const x = (width * s) / steps;
        const jitter = ((stableInt(`${seed}:${i}:${s}`) % 100) / 100 - 0.5) * amp * 2;
        pts.push(`${x.toFixed(1)},${(base + jitter).toFixed(1)}`);
      }
      pts.push(`${width},${height}`);
      const light = 12 + i * 7 + (li % 6);
      silhouettes += `<polygon points="${pts.join(" ")}" fill="hsl(${hue2} 30% ${light}%)" opacity="0.95"/>`;
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="hsl(${hue} 45% 24%)"/>
      <stop offset="60%" stop-color="hsl(${hue2} 40% 42%)"/>
      <stop offset="100%" stop-color="hsl(${hue2} 35% 58%)"/>
    </linearGradient>
    <radialGradient id="vig" cx="50%" cy="50%" r="75%">
      <stop offset="55%" stop-color="rgba(0,0,0,0)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0.55)"/>
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#sky)"/>
  <circle cx="${sun.x}" cy="${sun.y}" r="${sun.r}" fill="hsl(${(hue + 40) % 360} 70% 78%)" opacity="0.85"/>
  ${silhouettes}
  <rect width="${width}" height="${height}" fill="url(#vig)"/>
  <g opacity="0.9">
    <rect x="${Math.round(width * 0.03)}" y="${Math.round(height * 0.03)}" width="${Math.round(width * 0.16)}" height="${Math.round(height * 0.07)}" rx="${Math.round(height * 0.012)}" fill="rgba(0,0,0,0.55)"/>
    <text x="${Math.round(width * 0.11)}" y="${Math.round(height * 0.078)}" font-family="monospace" font-size="${Math.round(height * 0.035)}" fill="#ffffff" text-anchor="middle" letter-spacing="2">DEMO</text>
  </g>
</svg>`;

    const data = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
    return {
      data,
      mime: "image/png",
      width,
      height,
      provider: "demo",
      model: "demo-image-v1",
      isMock: true,
    };
  }
}
