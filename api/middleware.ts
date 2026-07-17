import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { getSessionFromRequest } from "./lib/auth";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const createRouter = t.router;
export const publicQuery = t.procedure;

export const authedProcedure = t.procedure.use(({ ctx, next }) => {
  const session = getSessionFromRequest(ctx.req);
  if (!session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Debes iniciar sesión para continuar.",
    });
  }
  return next({ ctx: { ...ctx, session } });
});

export const adminProcedure = authedProcedure.use(({ ctx, next }) => {
  if (ctx.session.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Solo el administrador puede hacer esto.",
    });
  }
  return next({ ctx });
});
