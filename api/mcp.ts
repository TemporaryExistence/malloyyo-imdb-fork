import {createHttpHandler} from '@malloydata/cli/mcp-http';

const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  console.log('calling handle...');
  try {
    await Promise.race([
      handle(req, res),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('handle timed out after 8s')), 8000)
      ),
    ]);
    console.log('handle returned OK');
  } catch (e: any) {
    console.error('handle error:', e?.message ?? String(e));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({error: e?.message ?? String(e)}));
    }
  }
}
