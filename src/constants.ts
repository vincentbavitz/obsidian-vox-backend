// Request validation headers
export const OBSIDIAN_VAULT_ID_HEADER_KEY = "obsidian-vault-id";
export const OBSIDIAN_API_KEY_HEADER_KEY = "obsidian-vox-api-key";

// Audio file constants
export const QUERY_PARAM_FILENAME = "filename";
export const QUERY_PARAM_FORMAT = "format";
export const FILE_EXTENSION_REGEX = /[.][\w]{2,6}$/;
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

// Server configuration
export const PORT = parseInt(process.env.BACKEND_PORT || "8000", 10);

// Ollama configuration
export const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:e4b";
