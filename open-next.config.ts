import { defineCloudflareConfig } from "@opennextjs/cloudflare";
const config = defineCloudflareConfig();
config.buildCommand = "SITES_BUILD=1 npm run build";
export default config;
