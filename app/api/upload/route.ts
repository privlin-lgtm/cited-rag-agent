import { handleUpload } from '../../../lib/api';
import { apiDeps } from '../../../lib/deps';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const POST = (request: Request) => handleUpload(request, apiDeps());
