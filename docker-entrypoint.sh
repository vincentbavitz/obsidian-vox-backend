#!/bin/sh
set -e

MODEL_PATH="${WHISPER_MODEL:-/models/ggml-small.en.bin}"
MODEL_NAME="${WHISPER_MODEL_NAME:-small.en}"

if [ ! -f "$MODEL_PATH" ]; then
  echo "[vox] Whisper model not found at $MODEL_PATH — downloading $MODEL_NAME..."
  mkdir -p "$(dirname "$MODEL_PATH")"
  curl -L --progress-bar \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL_NAME}.bin" \
    -o "$MODEL_PATH"
  echo "[vox] Model ready."
fi

exec "$@"
