# Dockerfile
FROM node:24-alpine

# Crear directorio de la aplicación
WORKDIR /usr/src/app

# Copiar dependencias
COPY package*.json ./

# Desactivar la verificación estricta de SSL temporalmente por el certificado vencido de Nexus
RUN npm config set strict-ssl false

# Instalar dependencias
RUN npm install

# Copiar el código de la aplicación, la base de datos y la carpeta del frontend (public)
COPY server.js .
COPY database.json .
COPY public ./public

# Configurar el puerto de la aplicación a 5000 para que coincida con Jenkins
ENV PORT=5000

# Exponer el puerto de la aplicación
EXPOSE 5000

# Comando para iniciar la aplicación usando server.js
CMD ["node", "server.js"]