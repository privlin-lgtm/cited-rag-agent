import { handleCleanup } from '../../../../lib/api';
import { apiDeps } from '../../../../lib/deps';

export const dynamic = 'force-dynamic';

export const GET = (request: Request) => handleCleanup(request, apiDeps());
