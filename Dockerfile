# ===================================================================
# Multi-stage Dockerfile para Soundking DB20P Controller (EasyPanel)
# ===================================================================

# Estágio 1: Build do frontend React + Vite
FROM node:22-alpine AS builder

WORKDIR /app

# Instala dependências aproveitando cache de camadas do Docker
COPY package*.json ./
RUN npm ci

# Copia código-fonte necessário para o build
COPY index.html vite.config.js ./
COPY src ./src
COPY tools ./tools

# Gera o bundle estático otimizado em /app/dist
RUN npm run build

# ===================================================================
# Estágio 2: Imagem final de execução (leve e segura)
# ===================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0

# Copia package.json e instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copia o frontend compilado do estágio anterior
COPY --from=builder /app/dist ./dist

# Copia o servidor backend (incluindo snapshot de simulação offline response-6400.bin)
COPY server ./server

# Porta padrão de escuta da aplicação
EXPOSE 8787

# Verificação de saúde periódica compatível com EasyPanel / Docker
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 8787) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Inicia o servidor unificado (Frontend SPA + API Ponte TCP/UDP)
CMD ["node", "server/index.js"]
