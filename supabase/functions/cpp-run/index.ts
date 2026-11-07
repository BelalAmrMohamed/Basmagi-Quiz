import { handle } from './handler.ts';
import { runProviders } from './providers.ts';
import { hitQuota } from './ratelimit.ts';

Deno.serve((req) => handle(req, {
  env: (k) => Deno.env.get(k),
  hitQuota,
  runProviders,
}));
