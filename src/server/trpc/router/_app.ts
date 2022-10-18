// src/server/router/_app.ts
import { router } from "../trpc";

import { exampleRouter } from "./example";
import { urlRouter } from "./url";

export const appRouter = router({
  example: exampleRouter,
  url: urlRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
