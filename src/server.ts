import cors from "cors";
import express from "express";
import { MAX_FILE_SIZE, OLLAMA_MODEL, OLLAMA_URL } from "./constants";
import { summarize } from "./controllers/summarization.controller";
import {
  convertAudio,
  transcribe,
} from "./controllers/transcription.controller";
import {
  validateRequestJson,
  validateRequestOctet,
} from "./middleware/validate-request";

const app = express();
const PORT = parseInt(process.env.BACKEND_PORT || "8000", 10);

// whisper-cli configuration
const WHISPER_CLI = process.env.WHISPER_CLI_PATH ?? "whisper-cli";
const WHISPER_MODEL = process.env.WHISPER_MODEL ?? "/models/ggml-small.en.bin";
const FFMPEG_PATH = process.env.FFMPEG_PATH ?? "./.ffmpeg/ffmpeg";

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
app.post("/transcribe", validateRequestOctet, transcribe);

/**
 * Audio conversion endpoint
 * POST /convert/audio?format={format}&filename={filename}
 * Body: application/octet-stream (raw audio bytes)
 * Headers: obsidian-vault-id (required), obsidian-vox-api-key (optional)
 * Returns: converted audio file as binary
 */
app.post("/convert/audio", validateRequestOctet, convertAudio);

/**
 * Summarization endpoint
 * POST /summarize
 * Body: application/json — { text: string, prompt?: string }
 * Headers: obsidian-vault-id (required), obsidian-vox-api-key (optional)
 * Returns: { summary: string }
 */
app.post("/summarize", validateRequestJson, summarize);

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
