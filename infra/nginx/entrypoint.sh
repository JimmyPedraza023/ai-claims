#!/bin/sh
# Si el certificado de Let's Encrypt aún no existe (primer arranque, antes de
# scripts/init-ssl.sh), genera uno autofirmado temporal para que nginx pueda
# levantar y responder el reto ACME del puerto 80. Con el cert real presente no
# toca nada.
set -e

DOMAIN="${DOMAIN:-localhost}"
CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
CERT="$CERT_DIR/fullchain.pem"
KEY="$CERT_DIR/privkey.pem"

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
  echo "[entrypoint] Certificado de Let's Encrypt no encontrado para $DOMAIN."
  echo "[entrypoint] Generando certificado autofirmado temporal (reemplazar con scripts/init-ssl.sh)."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
    -keyout "$KEY" -out "$CERT" \
    -subj "/CN=$DOMAIN" >/dev/null 2>&1
fi

exec /docker-entrypoint.sh "$@"