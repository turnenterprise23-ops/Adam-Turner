FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine

RUN apk add --no-cache libstdc++ curl

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data && chmod -R 777 /app/data

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/niches.db

CMD ["node", "server.js"]
