import {createHttpHandler} from '@malloydata/cli/mcp-http';
import type {IncomingMessage, ServerResponse} from 'node:http';

// Tell Vercel not to pre-parse the request body — the MCP transport reads the
// raw stream directly.
export const config = {
  api: {bodyParser: false},
};

const handle = createHttpHandler();

export default async function (
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  await handle(req, res);
}
