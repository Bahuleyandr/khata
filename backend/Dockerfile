FROM node:25.9.0-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:25.9.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG MINIMAX_MCP_VERSION=0.0.4
ARG WHISPER_CPP_REF=fc674574ca27cac59a15e5b22a09b9d9ad62aafe

# Python + uv + MiniMax MCP server (`minimax-coding-plan-mcp`) — provides the
# `understand_image` MCP tool used by vision intents. Installed at build time
# so the first runtime call doesn't pay the package-fetch latency.
#
# Plus ffmpeg + whisper.cpp + ggml-tiny (multilingual, ~75MB) for voice-note
# transcription. ffmpeg converts Telegram OGG/Opus -> 16kHz mono WAV; whisper
# does the actual speech-to-text. Tiny is the speed sweet spot for short
# voice notes (~1-2 sec to transcribe a 10-sec utterance on this CPU);
# upgrade to small/medium for better accuracy at higher latency.
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip ca-certificates ffmpeg \
        build-essential cmake git curl && \
    rm -rf /var/lib/apt/lists/* && \
    pip3 install --break-system-packages --no-cache-dir uv && \
    uv tool install "minimax-coding-plan-mcp==${MINIMAX_MCP_VERSION}" && \
    git clone https://github.com/ggerganov/whisper.cpp /tmp/whisper.cpp && \
    cd /tmp/whisper.cpp && \
    git checkout "${WHISPER_CPP_REF}" && \
    cmake -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF && \
    cmake --build build --target whisper-cli -j"$(nproc)" && \
    cp build/bin/whisper-cli /usr/local/bin/whisper-cli && \
    mkdir -p /opt/whisper-models && \
    bash models/download-ggml-model.sh tiny /opt/whisper-models && \
    cd / && rm -rf /tmp/whisper.cpp && \
    apt-get purge -y --auto-remove build-essential cmake git && \
    rm -rf /var/lib/apt/lists/*

# uv tool installs land in /root/.local/bin
ENV PATH="/root/.local/bin:${PATH}"
ENV WHISPER_MODEL_PATH=/opt/whisper-models/ggml-tiny.bin

COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

EXPOSE 3001
CMD ["node", "dist/index.js"]
