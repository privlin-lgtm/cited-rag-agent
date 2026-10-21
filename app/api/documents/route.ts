import { handleDocuments } from '../../../lib/api';
import { apiDeps } from '../../../lib/deps';

export const dynamic = 'force-dynamic';

export const GET = () => handleDocuments(apiDeps());
