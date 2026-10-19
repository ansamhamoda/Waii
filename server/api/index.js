
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/app.js";

const config = loadConfig();
const app = createApp(config);

export default app;
