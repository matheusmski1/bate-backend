FROM node:22-slim

RUN npm install -g pnpm@11.2.2

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 3001
CMD ["pnpm", "start"]
