FROM node:18-slim

# Install ffmpeg (required for audio processing by play-dl and @discordjs/voice)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Cache buster - change this to force npm reinstall
ARG CACHEBUST=3

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
