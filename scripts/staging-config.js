/**
 * Generate a flattened staging wrangler config from the build output.
 *
 * rwsdk's build produces dist/worker/wrangler.json as a "redirected" config.
 * Wrangler disallows env blocks in redirected configs, so we can't use
 * `wrangler deploy --env staging` with it. Instead, this script reads the
 * build output config and overwrites bindings/routes/vars with staging values.
 */
import { readFileSync, writeFileSync } from "node:fs";

const src = JSON.parse(readFileSync("dist/worker/wrangler.json", "utf-8"));

// Strip redirect-specific metadata
delete src.definedEnvironments;
delete src.configPath;
delete src.userConfigPath;
delete src.topLevelName;

// Apply staging overrides
Object.assign(src, {
  name: "auction-platform-staging",
  d1_databases: [
    {
      binding: "DB",
      database_name: "auction-platform-db-staging",
      database_id: "0999db0a-645c-443f-a210-92b94966e7ec",
    },
  ],
  r2_buckets: [
    {
      binding: "IMAGES",
      bucket_name: "auction-platform-images-staging",
    },
  ],
  queues: {
    producers: [
      { binding: "IMPORT_QUEUE", queue: "auction-import-queue-staging" },
    ],
    consumers: [{ queue: "auction-import-queue-staging" }],
  },
  routes: [
    { pattern: "staging-auction.digitalglue.dev", custom_domain: true },
  ],
  vars: {
    WEBAUTHN_APP_NAME: "auction-platform",
    WEBAUTHN_RP_ID: "staging-auction.digitalglue.dev",
  },
});

writeFileSync(
  "dist/worker/wrangler.staging.json",
  JSON.stringify(src, null, 2)
);
console.log("Created dist/worker/wrangler.staging.json");
