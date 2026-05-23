# --- build stage ---
FROM node:22-alpine AS build
WORKDIR /app
ARG VITE_API_URL
ARG VITE_MAP_STYLE_URL
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_MAP_STYLE_URL=$VITE_MAP_STYLE_URL
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# --- runtime stage (nginx) ---
FROM nginx:alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
