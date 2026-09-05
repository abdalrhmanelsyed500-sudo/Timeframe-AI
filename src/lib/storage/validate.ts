import { AppError } from "@/lib/errors";

/** Magic-byte sniffing. Content-Type headers are never trusted on their own. */
export type ImageFormat = "png" | "jpeg" | "webp";
export type AudioFormat = "mp3" | "wav" | "m4a" | "aac" | "flac";

export function sniffImage(buf: Buffer): ImageFormat | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

export function sniffAudio(buf: Buffer): AudioFormat | null {
  if (buf.length < 12) return null;
  const ascii4 = buf.toString("ascii", 0, 4);
  if (ascii4 === "fLaC") return "flac";
  if (ascii4 === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") return "wav";
  if (buf.toString("ascii", 4, 8) === "ftyp") {
    const brand = buf.toString("ascii", 8, 12);
    return /M4A|mp42|isom|iso2|mp41/.test(brand) ? "m4a" : "m4a";
  }
  if (ascii4.startsWith("ID3")) return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) {
    // MPEG audio frame sync — layer bits distinguish MP3 from raw AAC (ADTS).
    const layer = (buf[1] >> 1) & 0x03;
    return layer === 0 ? "aac" : "mp3";
  }
  return null;
}

export const IMAGE_MIME: Record<ImageFormat, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export const AUDIO_MIME: Record<AudioFormat, string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
};

export function assertImageBuffer(buf: Buffer, maxBytes = 25 * 1024 * 1024): ImageFormat {
  if (buf.byteLength === 0) throw new AppError("VALIDATION_ERROR", "Image file is empty.");
  if (buf.byteLength > maxBytes) throw new AppError("VALIDATION_ERROR", "Image file is too large.");
  const fmt = sniffImage(buf);
  if (!fmt) throw new AppError("VALIDATION_ERROR", "File is not a valid PNG, JPEG or WEBP image.");
  return fmt;
}

export function assertAudioBuffer(buf: Buffer, maxBytes: number): AudioFormat {
  if (buf.byteLength === 0) throw new AppError("VALIDATION_ERROR", "Audio file is empty.");
  if (buf.byteLength > maxBytes) {
    throw new AppError("VALIDATION_ERROR", `Audio file exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
  }
  const fmt = sniffAudio(buf);
  if (!fmt) {
    throw new AppError("VALIDATION_ERROR", "File is not a supported audio format (MP3, WAV, M4A, AAC, FLAC).");
  }
  return fmt;
}
