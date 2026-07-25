interface Env {
  DB: D1Database;
  DOWNLOADS: R2Bucket;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  RELEASE_UPLOAD_KEY?: string;
}
