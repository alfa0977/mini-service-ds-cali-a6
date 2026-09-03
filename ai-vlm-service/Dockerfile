# Use the official Bun image
FROM oven/bun:latest

# Set working directory
WORKDIR /app

# Copy dependency files
COPY package.json bun.lockb ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy the rest of the source code (includes index.ts)
COPY . .

# Expose the port
EXPOSE 3031

# Run the TypeScript file directly (Bun handles .ts natively)
CMD ["bun", "run", "index.ts"]
