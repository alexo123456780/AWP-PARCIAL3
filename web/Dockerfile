# PWA React + Vite. Targets: dev (Vite con hot reload) y prod (archivos estáticos servidos por Nginx).
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./

FROM base AS dev
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

FROM base AS build
RUN npm ci
COPY . .
# Vite incrusta VITE_* en el bundle: la URL de la API se fija al construir la imagen.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# Imagen sin privilegios: Nginx escucha en 8080 y corre como usuario no root.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
