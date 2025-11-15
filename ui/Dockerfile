FROM node:20

WORKDIR /ui

COPY package*.json ./
RUN npm install

COPY . /ui

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]


# COPY ui/ ./
#
# RUN npm install && npm run build
#
# FROM nginx:alpine
#
# COPY --from=build /ui/dist /usr/share/nginx/html
#
# COPY nginx.conf /etc/nginx/conf.d/default.conf
