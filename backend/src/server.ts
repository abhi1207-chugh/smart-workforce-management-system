import { createApp } from "./app.js";
import { loadConfig } from "./config/env.js";
import { initDatabase } from "./database/client.js";

const config = loadConfig();
const database = initDatabase(config.databaseUrl);
const app = createApp();

const server = app.listen(config.port, () => {
  console.log(`Backend listening on http://localhost:${config.port}`);
});

async function shutdown(signal: string): Promise<void> {
  console.log(`Received ${signal}, shutting down...`);
  server.close(async () => {
    await database.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

export { app, server, database };
