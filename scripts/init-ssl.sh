#!/usr/bin/env sh
# Obtiene el certificado Let's Encrypt para DOMAIN (webroot) y recarga nginx.
# Requiere: infra/.env con DOMAIN y LETSENCRYPT_EMAIL, y nginx levantado.
set -e
cd "$(dirname "$0")/.."

docker compose -f infra/docker-compose.yml run --rm certbot
docker compose -f infra/docker-compose.yml exec nginx nginx -s reload || true