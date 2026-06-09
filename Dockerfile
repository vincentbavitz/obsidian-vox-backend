# Use the whisper.cpp image as the base so whisper-cli and all its shared
# libraries (libwhisper.so, etc.) are already present and correctly linked.
# ffmpeg is also included in this image.
ARG WHISPER_IMAGE=ghcr.io/ggml-org/whisper.cpp:main-vulkan
FROM ${WHISPER_IMAGE}

# Install curl (for model download in entrypoint) and Node.js (for Bun installer)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN npm install -g bun

WORKDIR /usr/src/app

COPY package.json ./
RUN bun install
COPY . .

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["bun", "start:docker"]
