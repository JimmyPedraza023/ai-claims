FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
ARG VITE_API_URL=/api
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
RUN npm run build

FROM nginx:1.27-alpine
# openssl para el certificado temporal del entrypoint (no viene en la imagen).
RUN apk add --no-cache openssl
COPY infra/nginx/default.conf.template /etc/nginx/templates/default.conf.template
# Genera un certificado temporal si aún no existe el de Let's Encrypt, para que
# nginx pueda arrancar antes de correr scripts/init-ssl.sh.
COPY infra/nginx/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
COPY --from=build /app/dist /usr/share/nginx/html
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]