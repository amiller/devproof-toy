FROM node:22-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /data
WORKDIR /app
COPY app.js .
CMD ["node", "app.js"]
