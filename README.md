# Obsidian Vox Backend

A minimal Express.js server that provides audio transcription and format conversion for the Obsidian Vox plugin. Transcription is performed by invoking `whisper-cli` directly as a subprocess — no separate service, no HTTP calls between containers.

## Quick Start

### GPU Support (Vulkan — AMD, Intel, NVIDIA)
```bash
docker compose -f docker-compose.yaml up --build
```

This passes `/dev/dri` into the container so `whisper-cli` can use your GPU via Vulkan. Without it, the binary falls back to CPU automatically. Your user may need to be in the `video` or `render` group — check which group owns `/dev/dri/renderD128` with `ls -la /dev/dri`.

The backend starts on **http://localhost:8000**. On the first run, `docker-entrypoint.sh` automatically downloads the whisper model (~470 MB for `small.en`) to `./.cache/whisper-models/` if it isn't already cached.

## Endpoints

### Health Check
```
GET /health
```
Returns `{ status: "ok", timestamp: "..." }`.

### Transcribe Audio
```
POST /transcribe?filename={filename}
Content-Type: application/octet-stream

Headers:
  obsidian-vault-id: <16 alphanumeric characters>   (required)
  obsidian-vox-api-key: <key>                        (optional)
```

Transcription pipeline:
1. Audio buffer written to a temp file
2. FFmpeg converts it to 16kHz mono WAV (whisper-cli requirement)
3. `whisper-cli` runs on the WAV file, writing a JSON result
4. Temp files cleaned up; JSON response returned

Response:
```json
{
  "text": "Full transcribed text...",
  "language": "english",
  "segments": [
    { "timestamps": { "from": "00:00:00,000", "to": "00:00:02,000" }, "text": " Hello..." }
  ]
}
```

### Convert Audio Format
```
POST /convert/audio?format={wav|mp3|m4a|aac}&filename={filename}
Content-Type: application/octet-stream

Headers:
  obsidian-vault-id: <16 alphanumeric characters>   (required)
```

Returns: binary audio in the requested format.

Input formats accepted: `wav`, `mp3`, `m4a`, `aac`, `opus`, `ogg`

## Transcription Engine

The backend uses **whisper-cli** from [whisper.cpp](https://github.com/ggml-org/whisper.cpp) — a fast, lightweight C++ implementation of OpenAI's Whisper:

- **Fast**: Optimized C++ implementation
- **Lightweight**: No Python or ML framework dependencies
- **GPU-ready**: Uses a Vulkan-compiled binary that accelerates inference on AMD, Intel, or NVIDIA GPUs when `/dev/dri` is available, and falls back to CPU silently otherwise
- **Self-contained**: Binary is baked into the Docker image at build time

Both compose files use `ghcr.io/ggml-org/whisper.cpp:main-vulkan`. The GPU compose file simply passes `/dev/dri` through to the container to enable GPU access. No separate whisper service or network calls.

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `BACKEND_PORT` | `8000` | Port to listen on |
| `WHISPER_MODEL` | `/models/ggml-small.en.bin` | Path to the GGML model file |
| `WHISPER_MODEL_NAME` | `small.en` | Model name for auto-download on first start |
| `WHISPER_CLI_PATH` | `whisper-cli` | Path/name of the whisper-cli binary |
| `FFMPEG_PATH` | `ffmpeg` | Path/name of the ffmpeg binary |

### Changing the Whisper Model

Set `WHISPER_MODEL` and `WHISPER_MODEL_NAME` in `docker-compose.yaml`:

```yaml
environment:
  - WHISPER_MODEL=/models/ggml-base.en.bin
  - WHISPER_MODEL_NAME=base.en
```

Available models:

| Model | Size | Notes |
|---|---|---|
| `tiny.en` | 75 MB | Fastest, lowest quality |
| `base.en` | 142 MB | Good for quick testing |
| `small.en` | 466 MB | **Default** — good balance |
| `medium.en` | 1.5 GB | Slower, better quality |
| `large-v3` | 2.9 GB | Slowest, best quality |

Language-specific models (`.en`) are faster and more accurate for English. Drop the `.en` suffix for multilingual support.

## Local Development

To run the server outside Docker (useful for faster iteration):

```bash
bun install
bun setup          # Downloads FFmpeg to ./.ffmpeg/ (one-time)
bun dev            # Hot-reload dev server on port 8000
```

You will also need `whisper-cli` installed locally and in your `PATH`, and a model file available. Set `FFMPEG_PATH=./.ffmpeg/ffmpeg` (the default) and `WHISPER_MODEL` to point at your local model.

## Architecture

```
Plugin (HTTP POST, application/octet-stream)
    ↓
Backend (Express, port 8000)
    ├─→ POST /transcribe
    │       ↓ write temp file
    │       ↓ ffmpeg → 16kHz mono WAV
    │       ↓ Bun.spawn(whisper-cli) → JSON
    │       ↓ return { text, language, segments }
    │
    ├─→ POST /convert/audio
    │       ↓ ffmpeg → target format
    │       ↓ return binary audio
    │
    └─→ GET /health → { status: "ok" }
```

## Troubleshooting

### Build fails: `whisper-cli: file does not exist`
The binary path inside `ghcr.io/ggml-org/whisper.cpp:main` may have changed. The Dockerfile uses `which whisper-cli` to locate it dynamically — rebuild with `--no-cache`:
```bash
docker compose build --no-cache
```

### Model download is slow on first start
The model auto-downloads to `./.cache/whisper-models/` on the first run. This is a one-time download. Subsequent starts use the cached file.

### High transcription times
Switch to the GPU image:
```bash
docker compose -f docker-compose-gpu.yaml up --build
```
Or use a smaller model by changing `WHISPER_MODEL_NAME` to `tiny.en` or `base.en`.

### Updating the server

```bash
git pull
docker compose up --build
```

To force a full rebuild:
```bash
docker compose build --no-cache
docker compose up
```

### Running as a systemd service

A sample unit file is at `./systemd/obsidian-vox.service`. Install it with:

```bash
cp ./systemd/obsidian-vox.service /etc/systemd/system/
# Edit WorkingDirectory inside the file to match your path
systemctl daemon-reload
systemctl enable obsidian-vox
systemctl start obsidian-vox
```
