// Vercel serverless entry: runs the same Express app as `npm start`, for all /api/* routes.
import { loadConfig } from "../server/src/config.js";
import { createApp } from "../server/src/app.js";

const app = createApp(loadConfig());
export default app;
