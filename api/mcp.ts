import {createHttpHandler} from '@malloydata/cli/mcp-http';

// Tell Vercel not to pre-parse the request body — the MCP transport reads the
// raw stream directly.
export const config = {
  api: {bodyParser: false},
};

const handle = createHttpHandler();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function (req: any, res: any): Promise<void> {
  await handle(req, res);
}
