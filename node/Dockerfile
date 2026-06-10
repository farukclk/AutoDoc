FROM node:18-alpine

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy the root workspace config and package.json files
COPY package.json package-lock.json ./
COPY webhook_service/package.json ./webhook_service/
COPY pr_service/package.json ./pr_service/

# Install dependencies (NPM Workspaces will handle hoisting)
RUN npm install

# Copy the source codes
COPY webhook_service/src ./webhook_service/src
COPY pr_service/src ./pr_service/src

# We don't define CMD here because docker-compose will pass the correct start command
