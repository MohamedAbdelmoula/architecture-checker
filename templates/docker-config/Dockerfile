# Dockerfile multi-stage optimisé pour production
# ================================
# Stage 1: Build dependencies
# ================================
FROM node:18-alpine AS dependencies

# Ajouter labels pour métadonnées
LABEL maintainer="your-team@company.com"
LABEL version="1.0.0"
LABEL description="Application de production optimisée"

# Créer utilisateur non-root pour sécurité
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

# Installer dépendances système nécessaires
RUN apk add --no-cache \
    libc6-compat \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Définir répertoire de travail
WORKDIR /app

# Copier fichiers de dépendances
COPY package*.json ./
COPY yarn.lock* ./

# Installer dépendances avec cache optimisé
RUN npm ci --only=production --frozen-lockfile && \
    npm cache clean --force

# ================================
# Stage 2: Build application
# ================================
FROM node:18-alpine AS builder

WORKDIR /app

# Copier dépendances depuis stage précédent
COPY --from=dependencies /app/node_modules ./node_modules

# Copier code source
COPY . .

# Variables d'environnement pour le build
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Build de l'application
RUN npm run build && \
    npm prune --production

# ================================
# Stage 3: Runtime production
# ================================
FROM node:18-alpine AS runtime

# Installer dumb-init pour signal handling
RUN apk add --no-cache dumb-init

# Créer utilisateur non-root
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nextjs -u 1001

WORKDIR /app

# Copier uniquement les fichiers nécessaires
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Configuration sécurité
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Exposer port
EXPOSE 3000

# Basculer vers utilisateur non-root
USER nextjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

# Point d'entrée avec dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]