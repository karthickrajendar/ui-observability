import { buildServer } from './server';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const app = buildServer();
const port = Number(process.env['PORT'] ?? 4202);
await app.listen({ host: process.env['HOST'] ?? '127.0.0.1', port });
console.log('Observability API: http://localhost:' + port);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
