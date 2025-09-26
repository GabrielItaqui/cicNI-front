FROM node:20-alpine
WORKDIR /app

# Instala apenas a partir dos manifests para cache eficiente
COPY package*.json ./
RUN npm ci

# Copia o restante do código (em dev usaremos bind mount, mas mantém para build puro)
COPY . .

EXPOSE 5173
# --host permite acesso externo ao dev server dentro do container
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
