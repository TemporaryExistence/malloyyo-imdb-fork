import {createHttpHandler} from '@malloydata/cli/mcp-http';

const handle = createHttpHandler();

export default async function (req: any, res: any): Promise<void> {
  await handle(req, res);
}
