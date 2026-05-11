import path from 'path';
import {createHttpHandler} from '@malloydata/cli/mcp-http';

// On Vercel, __dirname is the function bundle directory (/var/task/api).
// The buildCommand copies malloy-config.json and model files there.
const handle = createHttpHandler({configDir: __dirname});

export default async function (req: any, res: any): Promise<void> {
  await handle(req, res);
}
