export {};

declare global {
  namespace Cloudflare {
    interface Env {
      DB: D1Database;
      MEDIA: R2Bucket;
      ASSETS: Fetcher;
    }
  }
}
