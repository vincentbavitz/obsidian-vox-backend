import axios from "axios";
import type { Request, Response } from "express";
import { OLLAMA_MODEL, OLLAMA_URL } from "../constants";

/**
 * Handler for POST /summarize
 */
export async function summarize(req: Request, res: Response): Promise<void> {
  try {
    const vaultId = req.vaultId;

    let body: { text?: string; prompt?: string };
    try {
      body = JSON.parse((req.body as Buffer).toString("utf-8"));
    } catch {
      res.status(400).json({ error: "Invalid JSON body." });
      return;
    }

    const { text, prompt } = body;

    if (typeof text !== "string" || text.trim() === "") {
      res.status(400).json({
        error: "Missing or empty 'text' field in request body.",
      });
      return;
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

    res.status(200).json({ summary: summary.trim() });
  } catch (error) {
    console.error("[SUMMARIZE] Error:", error);
    res.status(500).json({
      error: "Summarization failed",
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
