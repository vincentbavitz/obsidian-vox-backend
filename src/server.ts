import axios from "axios";
import cors from "cors";
import type { Request, Response } from "express";
import express from "express";
import ffmpeg from "fluent-ffmpeg";
import fs from "fs/promises";
import os from "os";
import path from "path";
import {
  MAX_FILE_SIZE,
  OLLAMA_MODEL,
  OLLAMA_URL,
  QUERY_PARAM_FILENAME,
  QUERY_PARAM_FORMAT,
} from "./constants";
import validateRequest from "./middleware/validate-request";
import validateRequestJson from "./middleware/validate-request-json";

const app = express();
const PORT = parseInt(process.env.BACKEND_PORT || "8000", 10);

// whisper-cli configuration
const WHISPER_CLI = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "/models/ggml-small.en.bin";

// Audio format support
type AudioFormat = "wav" | "mp3" | "m4a" | "aac";
const VALID_AUDIO_FORMATS: AudioFormat[] = ["wav", "mp3", "m4a", "aac"];

// FFmpeg setup — Docker sets FFMPEG_PATH=ffmpeg (system); local dev uses downloaded binary
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "./.ffmpeg/ffmpeg";
ffmpeg.setFfmpegPath(FFMPEG_PATH);

// Types
interface TranscriptionResponse {
  text: string;
  language: string;
  segments: unknown[];
}

// ============================================================================
// QUERY PARAMETER VALIDATION HELPERS
// ============================================================================

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
  // Normalise to Buffer for downstream code
  if (!isBuffer) req.body = Buffer.from(b as Uint8Array);
  return true;
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.raw({ type: () => true, limit: MAX_FILE_SIZE }));

// ============================================================================
// ENDPOINTS
// ============================================================================

/**
 * Health check endpoint
 * GET /health
 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Transcription endpoint
 * POST /transcribe?filename={filename}
 * Body: application/octet-stream (raw audio bytes)
 * Headers: obsidian-vault-id (required), obsidian-vox-api-key (optional)
 * Returns: { text, language, segments }
 */
app.post(
  "/transcribe",
  validateRequest,
  async (req: Request, res: Response) => {
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

      // whisper-cli requires 16-bit 16kHz mono WAV
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

      // -oj writes JSON to {wavPath}.json
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

      return res.status(200).json({
        text,
        language: whisperOutput.result?.language ?? "en",
        segments,
      } satisfies TranscriptionResponse);
    } catch (error) {
      console.error("[TRANSCRIBE] Error:", error);
      return res.status(500).json({
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
  },
);

/**
 * Audio conversion endpoint
 * POST /convert/audio?format={format}&filename={filename}
 * Body: application/octet-stream (raw audio bytes)
 * Headers: obsidian-vault-id (required), obsidian-vox-api-key (optional)
 * Returns: converted audio file as binary
 */
app.post(
  "/convert/audio",
  validateRequest,
  async (req: Request, res: Response) => {
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

      // Derive input extension from filename
      const inputExtension = filename.split(".").pop()?.toLowerCase();
      if (!inputExtension) {
        return res.status(400).json({
          error: "Could not determine input format from the provided filename.",
        });
      }

      if (inputExtension === targetFormat) {
        return res.status(400).json({
          error: `Input and output formats are the same: '${targetFormat}'.`,
        });
      }

      console.log(
        `[CONVERT] Vault ${vaultId}: ${filename} (${inputExtension} → ${targetFormat})`,
      );

      // Write buffer to a temp input file so FFmpeg can read it
      const inputPathWithExt = `${inputPath}.${inputExtension}`;
      const outputPathWithExt = `${outputPath}.${targetFormat}`;

      await fs.writeFile(inputPathWithExt, Uint8Array.from(audioBuffer));

      // Convert using FFmpeg
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

      // Send converted file
      const convertedBuffer = await fs.readFile(outputPathWithExt);
      res.setHeader("Content-Type", `audio/${targetFormat}`);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="converted.${targetFormat}"`,
      );
      res.send(convertedBuffer);

      // Clean up temp files
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

      // Best-effort cleanup on error
      await Promise.all([
        fs.rm(`${inputPath}.*`).catch(() => {}),
        fs.rm(`${outputPath}.*`).catch(() => {}),
      ]);

      return res.status(500).json({
        error: "Audio conversion failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

/**
 * Summarization endpoint
 * POST /summarize
 * Body: application/json — { text: string, prompt?: string }
 * Headers: obsidian-vault-id (required), obsidian-vox-api-key (optional)
 * Returns: { summary: string }
 */
app.post(
  "/summarize",
  validateRequestJson,
  async (req: Request, res: Response) => {
    try {
      const vaultId = req.vaultId;

      let body: { text?: string; prompt?: string };
      try {
        body = JSON.parse((req.body as Buffer).toString("utf-8"));
      } catch {
        return res.status(400).json({ error: "Invalid JSON body." });
      }

      const { text, prompt } = body;

      if (typeof text !== "string" || text.trim() === "") {
        return res.status(400).json({
          error: "Missing or empty 'text' field in request body.",
        });
      }

      const ollamaPrompt =
        typeof prompt === "string" && prompt.trim() !== ""
          ? `${prompt.trim()}\n\n${text.trim()}`
          : `Please summarize the following transcription concisely using Markdown syntax:\n\n${text.trim()}`;

      console.log(
        `[SUMMARIZE] Vault ${vaultId}: ${text.length} chars → ${OLLAMA_MODEL}`,
      );

      const response = await axios.post(
        `${OLLAMA_URL}/api/generate`,
        { model: OLLAMA_MODEL, prompt: ollamaPrompt, stream: false },
        { headers: { "Content-Type": "application/json" } },
      );

      const summary: string = response.data?.response ?? "";

      console.log(`[SUMMARIZE] Success for vault ${vaultId}`);

      return res.status(200).json({ summary: summary.trim() });
    } catch (error) {
      console.error("[SUMMARIZE] Error:", error);
      return res.status(500).json({
        error: "Summarization failed",
        details: error instanceof Error ? error.message : String(error),
      });
    }
  },
);

// ============================================================================
// ERROR HANDLING & SERVER STARTUP
// ============================================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    path: req.path,
    availableEndpoints: {
      "POST /transcribe": "Transcribe audio to text",
      "POST /convert/audio": "Convert audio format",
      "POST /summarize": "Summarize transcription text via Ollama",
      "GET /health": "Health check",
    },
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`✓ Obsidian Vox backend running on http://0.0.0.0:${PORT}`);
  console.log(`  whisper-cli: ${WHISPER_CLI}`);
  console.log(`  model:       ${WHISPER_MODEL}`);
  console.log(`  ffmpeg:      ${FFMPEG_PATH}`);
  console.log(`  ollama:      ${OLLAMA_URL} (model: ${OLLAMA_MODEL})`);
  console.log(`\n  Endpoints:`);
  console.log(
    `    POST /transcribe?filename={filename}               - Transcribe audio to text`,
  );
  console.log(
    `    POST /convert/audio?format={format}&filename={fn} - Convert audio format`,
  );
  console.log(
    `    POST /summarize                                    - Summarize text via Ollama`,
  );
  console.log(
    `    GET  /health                                       - Health check`,
  );
  console.log(
    `\n  Required header: obsidian-vault-id (16 alphanumeric characters)`,
  );
  console.log(`  Optional header: obsidian-vox-api-key (for your reference)\n`);
});
