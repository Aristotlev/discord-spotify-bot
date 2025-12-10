FROM node:20-slim

# Install yt-dlp, ffmpeg, and dependencies for native audio/voice
RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    build-essential \
    libtool \
    autoconf \
    automake \
    libopus-dev \
    libsodium-dev \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Verify yt-dlp and ffmpeg installation
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app

# Cache buster - change this to force npm reinstall
ARG CACHEBUST=7

# Copy package files
COPY package*.json ./

# Install ALL dependencies (need devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Remove dev dependencies after build
RUN npm prune --production

# Expose port for OAuth callback server
EXPOSE 8080

# Set environment variable for Cloud Run
ENV PORT=8080

# Run the bot
CMD ["node", "dist/index.js"]
