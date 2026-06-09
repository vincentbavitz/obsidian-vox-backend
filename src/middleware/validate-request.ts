import type { NextFunction, Request, Response } from "express";

const OBSIDIAN_VAULT_ID_HEADER_KEY = "obsidian-vault-id";
const OBSIDIAN_API_KEY_HEADER_KEY = "obsidian-vox-api-key";
const OBSIDIAN_VAULT_ID_REGEX = /[a-z0-9]{16}/i;

/**
 * Simplified middleware to validate request headers.
 * - Checks Content-Type is application/octet-stream
 * - Validates obsidian-vault-id header format
 * - Logs API key if provided (but doesn't enforce limits)
 *
 * No database checks or rate-limiting in this simplified version.
 * Users can setup their own backend security (Tailscale, API keys, etc.)
 */
const validateRequestOctet = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  // Check Content-Type
  const isOctetStream = req.headers["content-type"]?.startsWith(
    "application/octet-stream",
  );

  if (!isOctetStream) {
    return res.status(400).json({
      error:
        "Please send your request with Content-Type: application/octet-stream.",
    });
  }

  // Check and validate vault ID header
  const vaultId = String(req.headers[OBSIDIAN_VAULT_ID_HEADER_KEY] || "");
  const isVaultIdValid = vaultId.match(OBSIDIAN_VAULT_ID_REGEX);

  if (!vaultId || !isVaultIdValid) {
    return res.status(400).json({
      error: `Missing or invalid ${OBSIDIAN_VAULT_ID_HEADER_KEY} header. Expected 16 alphanumeric characters.`,
    });
  }

  // Log vault ID for monitoring
  console.log(`[REQUEST] Vault ${vaultId} | Path: ${req.path}`);

  // Log API key if provided (for user's reference, not enforced)
  const apiKey = req.headers[OBSIDIAN_API_KEY_HEADER_KEY];
  if (apiKey) {
    console.log(`[REQUEST] API key provided (not enforced in local mode)`);
  }

  // Attach vault ID to request for use in handlers
  req.vaultId = vaultId;
  req.apiKey = (apiKey as string) || null;

  next();
};

export default validateRequestOctet;
