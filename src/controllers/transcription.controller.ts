import type { Request, Response } from "express";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  QUERY_PARAM_FILENAME,
  QUERY_PARAM_FORMAT,
} from "../constants";

const WHISPER_CLI = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "/models/ggml-small.en.bin";
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "./.ffmpeg/ffmpeg";

type AudioFormat = "wav" | "mp3" | "m4a" | "aac";
const VALID_AUDIO_FORMATS: AudioFormat[] = ["wav", "mp3", "m4a", "aac"];

interface TranscriptionResponse {
  text: string;
  language: string;
  segments: unknown[];
}

ffmpeg.setFfmpegPath(FFMPEG_PATH);

/**
 * Extracts and validates the `filename` query param.
 * Returns the filename string or sends a 400 and returns null.
 */
function requireFilenameParam(req: Request, res: Response): string | null {
  const filename = req.query[QUERY_PARAM_FILENAME];
  if (typeof filename !== "string" || filename.trim() === "") {
    res.status(400).json({
      error: `Missing or empty query parameter: '${QUERY_PARAM_FILENAME}'. Provide the audio filename including its extension.`,
    });
    return null;
  }
  return filename.trim();
}

/**
 * Extracts and validates the `format` query param against the allowed audio formats.
 * Returns the format string or sends a 400 and returns null.
 */
function requireFormatParam(req: Request, res: Response): AudioFormat | null {
  const format = req.query[QUERY_PARAM_FORMAT];
  if (typeof format !== "string" || format.trim() === "") {
    res.status(400).json({
      error: `Missing or empty query parameter: '${QUERY_PARAM_FORMAT}'. Valid formats: ${VALID_AUDIO_FORMATS.join(", ")}.`,
    });
    return null;
  }
  const trimmed = format.trim().toLowerCase();
  if (!VALID_AUDIO_FORMATS.includes(trimmed as AudioFormat)) {
    res.status(400).json({
      error: `Invalid '${QUERY_PARAM_FORMAT}' value: '${trimmed}'. Valid formats: ${VALID_AUDIO_FORMATS.join(", ")}.`,
    });
    return null;
  }
  return trimmed as AudioFormat;
}

/**
 * Validates that the request body is a non-empty Buffer.
 * Sends a 400 if not and returns false.
 */
function requireBodyBuffer(req: Request, res: Response): boolean {
  const b = req.body;
  const isBuffer = Buffer.isBuffer(b);
  const isUint8 = b instanceof Uint8Array;
  if ((!isBuffer && !isUint8) || b.length === 0) {
    console.error(
      `[BODY] validation failed — typeof=${typeof b} constructor=${b?.constructor?.name} isBuffer=${isBuffer} isUint8=${isUint8} length=${b?.length}`,
    );
    res.status(400).json({
      error:
        "Request body must be non-empty binary audio data (application/octet-stream).",
    });
    return false;
  }
  if (!isBuffer) req.body = Buffer.from(b as Uint8Array);
  return true;
}

/**
 * Handler for POST /transcribe
 */
export async function transcribe(req: Request, res: Response): Promise<void> {
  const tmpId = `vox-${Date.now()}`;
  let inputPath: string | null = null;
  let wavPath: string | null = null;

  try {
    const vaultId = req.vaultId;
    const filename = requireFilenameParam(req, res);
    if (!filename) return;

    if (!requireBodyBuffer(req, res)) return;

    const audioBuffer = req.body as Buffer;

    console.log(`[TRANSCRIBE] Vault ${vaultId}: ${filename}`);

    const extension = filename.split(".").pop()?.toLowerCase() ?? "wav";
    inputPath = path.join(os.tmpdir(), `${tmpId}-in.${extension}`);
    wavPath = path.join(os.tmpdir(), `${tmpId}.wav`);

    await fs.writeFile(inputPath, Uint8Array.from(audioBuffer));

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath!)
        .audioFrequency(16000)
        .audioChannels(1)
        .audioCodec("pcm_s16le")
        .toFormat("wav")
        .on("end", () => resolve())
        .on("error", reject)
        .save(wavPath!);
    });

    console.log(`[TRANSCRIBE] Running whisper-cli for ${filename}`);

    const proc = Bun.spawn(
      [WHISPER_CLI, "-m", WHISPER_MODEL, "-f", wavPath, "-oj"],
      { stdout: "ignore", stderr: "pipe" },
    );

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`whisper-cli failed (exit ${exitCode}): ${stderr}`);
    }

    const jsonPath = `${wavPath}.json`;
    const whisperOutput = JSON.parse(await fs.readFile(jsonPath, "utf-8"));

    const segments: Array<{ text: string }> =
      whisperOutput.transcription ?? [];
    const text = segments
      .map((s) => s.text)
      .join("")
      .trim();

    console.log(`[TRANSCRIBE] Success: ${filename}`);

    res.status(200).json({
      text,
      language: whisperOutput.result?.language ?? "en",
      segments,
    } satisfies TranscriptionResponse);
  } catch (error) {
    console.error("[TRANSCRIBE] Error:", error);
    res.status(500).json({
      error: "Transcription failed",
      details: error instanceof Error ? error.message : String(error),
    });
  } finally {
    await Promise.allSettled([
      inputPath ? fs.rm(inputPath) : Promise.resolve(),
      wavPath ? fs.rm(wavPath) : Promise.resolve(),
      wavPath ? fs.rm(`${wavPath}.json`) : Promise.resolve(),
    ]);
  }
}

/**
 * Handler for POST /convert/audio
 */
export async function convertAudio(
  req: Request,
  res: Response,
): Promise<void> {
  const inputPath = path.join(os.tmpdir(), `vox-input-${Date.now()}`);
  const outputPath = path.join(os.tmpdir(), `vox-output-${Date.now()}`);

  try {
    const vaultId = req.vaultId;

    const targetFormat = requireFormatParam(req, res);
    if (!targetFormat) return;

    const filename = requireFilenameParam(req, res);
    if (!filename) return;

    if (!requireBodyBuffer(req, res)) return;

    const audioBuffer = req.body as Buffer;

    const inputExtension = filename.split(".").pop()?.toLowerCase();
    if (!inputExtension) {
      res.status(400).json({
        error: "Could not determine input format from the provided filename.",
      });
      return;
    }

    if (inputExtension === targetFormat) {
      res.status(400).json({
        error: `Input and output formats are the same: '${targetFormat}'.`,
      });
      return;
    }

    console.log(
      `[CONVERT] Vault ${vaultId}: ${filename} (${inputExtension} → ${targetFormat})`,
    );

    const inputPathWithExt = `${inputPath}.${inputExtension}`;
    const outputPathWithExt = `${outputPath}.${targetFormat}`;

    await fs.writeFile(inputPathWithExt, Uint8Array.from(audioBuffer));

    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPathWithExt)
        .toFormat(targetFormat)
        .on("end", () => {
          console.log(`[CONVERT] Success: ${filename}`);
          resolve();
        })
        .on("error", (err: Error) => {
          console.error(`[CONVERT] FFmpeg error:`, err.message);
          reject(err);
        })
        .save(outputPathWithExt);
    });

    const convertedBuffer = await fs.readFile(outputPathWithExt);
    res.setHeader("Content-Type", `audio/${targetFormat}`);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="converted.${targetFormat}"`,
    );
    res.send(convertedBuffer);

    await Promise.all([
      fs
        .rm(inputPathWithExt)
        .catch((err) =>
          console.warn(
            `[CONVERT] Failed to clean up input temp file: ${(err as Error).message}`,
          ),
        ),
      fs
        .rm(outputPathWithExt)
        .catch((err) =>
          console.warn(
            `[CONVERT] Failed to clean up output temp file: ${(err as Error).message}`,
          ),
        ),
    ]);
  } catch (error) {
    console.error("[CONVERT] Error:", error);

    await Promise.all([
      fs.rm(`${inputPath}.*`).catch(() => {}),
      fs.rm(`${outputPath}.*`).catch(() => {}),
    ]);

    res.status(500).json({
      error: "Audio conversion failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
