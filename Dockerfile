# 修正前：FROM oven/bun:1.1-slim
FROM docker.io/oven/bun:1.1-slim

WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install
COPY . .
EXPOSE 3000
CMD ["bun", "run", "dev"]