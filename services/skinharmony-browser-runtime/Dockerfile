FROM mcr.microsoft.com/playwright:v1.62.1-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
EXPOSE 8795
CMD ["node", "src/server.js"]
