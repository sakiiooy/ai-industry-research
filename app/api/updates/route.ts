import { createUpdatesHandler } from '../../../src/updates.mjs';
import snapshot from '../../../src/data.json';

export const dynamic = 'force-dynamic';

// This closure is isolate-local. No visitor input selects outbound URLs.
const handleUpdates = createUpdatesHandler(snapshot.sources);

export async function GET(request: Request) {
  return handleUpdates(request);
}
