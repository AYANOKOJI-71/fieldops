import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import * as db from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";

const syncMutationSchema = z.object({
  clientMutationId: z.string().min(8).max(128), entityType: z.enum(["work_order", "visit"]), entityId: z.string().min(1).max(96), operation: z.enum(["create", "update", "resolve_conflict"]), payload: z.record(z.string(), z.unknown()), baseVersion: z.number().int().min(0), createdAt: z.string().datetime(),
});

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  fieldService: router({
    pull: protectedProcedure.input(z.object({ cursor: z.coerce.date().optional() }).optional()).query(({ ctx, input }) => db.getFieldServiceSnapshot(ctx.user.openId, input?.cursor)),
    push: protectedProcedure.input(z.object({ mutations: z.array(syncMutationSchema).min(1).max(100) })).mutation(({ ctx, input }) => db.applyFieldServiceMutations(ctx.user.openId, input.mutations)),
  }),
});
export type AppRouter = typeof appRouter;
