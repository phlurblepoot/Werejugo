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
# Where to reach the backend. Overridable at runtime (e.g. on unraid the backend
# container may have a different name). nginx's entrypoint substitutes these into
# the template; the filter ensures only BACKEND_* are touched (not nginx's own vars).
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=4000
ENV NGINX_ENVSUBST_FILTER=BACKEND_
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
