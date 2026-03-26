FROM node:20-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
COPY docs/ docs/
RUN npx tsc
RUN cp -r src/server/website/docs dist/server/website/docs

FROM node:20-slim

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY docs/ docs/
COPY --from=build /app/dist dist/

ENV REPOS_DIR=/tmp/joincloud-repos

EXPOSE 3000 3003

CMD ["node", "dist/server/index.js"]
