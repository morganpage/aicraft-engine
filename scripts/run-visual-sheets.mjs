import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});

try {
  await server.ssrLoadModule('/benchmarks/_scripts/visual-sheets.ts');
} finally {
  await server.close();
}
