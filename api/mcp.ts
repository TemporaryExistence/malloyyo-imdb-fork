import {createHttpHandler} from '@malloydata/cli/mcp-http';

const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  // Diagnostic: what does Vercel give us?
  console.log('body type:', typeof req.body);
  console.log('body value:', JSON.stringify(req.body));
  console.log('readable ended:', req.readableEnded);
  console.log('readable flowing:', req.readableFlowing);

  // Try to read from stream directly
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: any) => { console.log('got chunk', c.length); chunks.push(c); });
    req.on('end', () => { console.log('stream ended'); resolve(); });
    req.on('error', (e: any) => { console.log('stream error', e.message); reject(e); });
    // If stream is already ended, we need a way out
    setTimeout(() => { console.log('stream timeout'); resolve(); }, 2000);
  });

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    bodyType: typeof req.body,
    hasBody: req.body !== undefined,
    streamChunks: chunks.length,
    streamBytes: chunks.reduce((n, c) => n + c.length, 0),
    readableEnded: req.readableEnded,
  }));
}
