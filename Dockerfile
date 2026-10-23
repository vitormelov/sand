# SAND — single container: API + static web app + SQLite.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# Dev dependencies are needed to build the web bundle; pruned afterwards.
RUN npm ci --include=dev
COPY . .
RUN npx vite build && npm prune --omit=dev

# Persist the SQLite database by mounting a volume here.
VOLUME ["/app/data"]
EXPOSE 8787
CMD ["npm", "start"]
