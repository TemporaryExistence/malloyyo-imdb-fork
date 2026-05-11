import {createHttpHandler} from '@malloydata/cli/mcp-http';
import fs from 'fs';

const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  const steps: string[] = [];
  const t = () => Date.now();
  const t0 = t();

  // Step 1: file system check
  const cwd = process.cwd();
  const hasConfig = fs.existsSync(`${cwd}/malloy-config.json`);
  const hasDuckdb = fs.existsSync(`${cwd}/data/imdb.duckdb`);
  steps.push(`cwd=${cwd} config=${hasConfig} duckdb=${hasDuckdb} body=${typeof req.body}`);
  console.log('step1:', steps[0]);

  // Step 2: call handle with tight race timeout
  try {
    await Promise.race([
      handle(req, res),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`handle timeout at ${Date.now() - t0}ms`)), 8000)
      ),
    ]);
    console.log('handle OK in', Date.now() - t0, 'ms');
  } catch (e: any) {
    console.error('handle failed:', e?.message, 'steps:', steps.join('; '));
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({steps, error: e?.message}));
    }
  }
}
