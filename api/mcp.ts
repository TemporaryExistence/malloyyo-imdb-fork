import {createHttpHandler} from '@malloydata/cli/mcp-http';

const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  const t0 = Date.now();
  console.log('req.body type:', typeof req.body, '| method:', req.method);
  try {
    await handle(req, res);
    console.log('handle OK in', Date.now() - t0, 'ms');
  } catch (e: any) {
    console.error('handle threw:', e?.message);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({error: String(e?.message)}));
    }
  }
}
