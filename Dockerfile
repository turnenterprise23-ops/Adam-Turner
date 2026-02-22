FROM node:20-alpine

WORKDIR /app

# Install build tools needed for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

# Install dependencies first for better caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Remove build tools after install to keep image small
RUN apk del python3 make g++

# Copy application code
COPY server.js ./
COPY public ./public/

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Run as non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
RUN chown -R appuser:appgroup /app
USER appuser

CMD ["node", "server.js"]
