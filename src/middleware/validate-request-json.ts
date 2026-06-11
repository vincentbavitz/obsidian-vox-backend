import type { NextFunction, Request, Response } from "express";

const OBSIDIAN_VAULT_ID_HEADER_KEY = "obsidian-vault-id";
const OBSIDIAN_API_KEY_HEADER_KEY = "obsidian-vox-api-key";
const OBSIDIAN_VAULT_ID_REGEX = /[a-z0-9]{16}/i;

/**
 * Middleware for JSON endpoints (e.g. /summarize).
 * - Checks Content-Type is application/json
 * - Validates obsidian-vault-id header format
 * - Attaches vaultId/apiKey to request
 */
const validateRequestJson = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const isJson = req.headers["content-type"]?.startsWith("application/json");

  if (!isJson) {
    return res.status(400).json({
      error: "Please send your request with Content-Type: application/json.",
    });
  }

  const vaultId = String(req.headers[OBSIDIAN_VAULT_ID_HEADER_KEY] || "");
  const isVaultIdValid = vaultId.match(OBSIDIAN_VAULT_ID_REGEX);

  if (!vaultId || !isVaultIdValid) {
    return res.status(400).json({
      error: `Missing or invalid ${OBSIDIAN_VAULT_ID_HEADER_KEY} header. Expected 16 alphanumeric characters.`,
    });
  }

  console.log(`[REQUEST] Vault ${vaultId} | Path: ${req.path}`);

  const apiKey = req.headers[OBSIDIAN_API_KEY_HEADER_KEY];
  if (apiKey) {
    console.log(`[REQUEST] API key provided (not enforced in local mode)`);
  }

  req.vaultId = vaultId;
  req.apiKey = (apiKey as string) || null;

  next();
};

export default validateRequestJson;
