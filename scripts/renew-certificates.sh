#!/usr/bin/env sh
# Renueva el certificado Let's Encrypt (si falta > 60 días no hace nada) y
# recarga nginx para que tome el nuevo. Programar con cron, p. ej.:
#   15 3 * * * /ruta/al/repo/scripts/renew-certificates.sh >> /var/log/certbot-renew.log 2>&1
set -e
cd "$(dirname "$0")/.."

docker compose -f infra/docker-compose.yml run --rm certbot renew
docker compose -f infra/docker-compose.yml exec nginx nginx -s reload || true