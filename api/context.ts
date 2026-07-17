import type { IncomingMessage, ServerResponse } from "node:http";

export type TrpcContext = {
  req: IncomingMessage;
  res: ServerResponse;
};

export async function createContext(opts: { req: IncomingMessage; res: ServerResponse }): Promise<TrpcContext> {
  return { req: opts.req, res: opts.res };
}
