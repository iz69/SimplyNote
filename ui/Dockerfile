FROM node:22-alpine AS build
WORKDIR /ui

COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:stable-alpine
LABEL org.opencontainers.image.source="https://github.com/iz69/SimplyNote"
ENV UI_BASE_PATH=/simplynote/ \
    API_BASE_PATH=/simplynote-api \
    ENABLE_API=true \
    ENABLE_DRIVE=true

RUN apk add --no-cache python3
COPY --from=build /ui/dist /opt/simplynote/dist
COPY runtime/generate_config.py /opt/simplynote/generate_config.py
COPY docker-entrypoint.d/40-simplynote-runtime.sh /docker-entrypoint.d/40-simplynote-runtime.sh
RUN chmod +x /docker-entrypoint.d/40-simplynote-runtime.sh
EXPOSE 5173
