// Cloudflare Worker: show-vendor inventory upload and management
// Routes (all authenticated via Supabase JWT):
//   GET  /vendor/me
//   GET  /vendor/inventory?show_id=...
//   POST /vendor/inventory         (batch create/upsert)
//   POST /vendor/inventory/update  (edit a row)
//   POST /vendor/inventory/delete  (remove a row)
//
// Implementation is split across worker_show_vendor/: dispatch.js holds the
// route table; handlers/ holds the route handlers; turso.js is the only
// module that speaks /v2/pipeline; schema.js owns ensureSchema.

export { default } from "./worker_show_vendor/dispatch.js";
