import {createHttpHandler} from '@malloydata/cli/mcp-http';

// Import works — now test calling createHttpHandler without a request
const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ok: true, handlerType: typeof handle}));
}
