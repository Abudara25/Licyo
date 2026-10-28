# Image de production Licyo : serveur Next.js autonome, sans dépendance d'hébergeur.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Variables publiques figées au build (domaine, URL et clé anonyme Supabase).
ARG NEXT_PUBLIC_ROOT_DOMAIN
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S licyo && adduser -S licyo -G licyo
COPY --from=build --chown=licyo:licyo /app/.next/standalone ./
COPY --from=build --chown=licyo:licyo /app/.next/static ./.next/static
COPY --from=build --chown=licyo:licyo /app/public ./public
USER licyo
EXPOSE 3000
CMD ["node", "server.js"]
