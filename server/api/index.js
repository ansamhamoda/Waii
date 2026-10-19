import { createApp } from "../server/src/app.js";
import { loadConfig } from "../server/src/config.js";

export default createApp(loadConfig());
