import { endpoint, HttpError, json, service, verifiedUser } from '../_shared/http.ts';
import { createReporter } from './reporting.ts';

const report = createReporter();
export const handle = endpoint(async (request, headers) => {
  const user_id = await verifiedUser(request, true);
  // Only a remotely verified user ID reaches the service-role-only RPC.
  // Request bodies cannot choose a user, property, metric or date range.
  let access;
  try { access = await service('authorize_analytics', { user_id }); }
  catch (error) {
    if (error instanceof HttpError && error.status === 400) throw new HttpError(403, 'Staff access is required to view website analytics.');
    throw error;
  }
  if (access?.allowed !== true) throw new HttpError(403, 'Staff access is required to view website analytics.');
  return json(await report(), 200, headers);
});
