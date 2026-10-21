import { handleDelete } from '../../../../lib/api';
import { apiDeps } from '../../../../lib/deps';

export const dynamic = 'force-dynamic';

export const DELETE = async (request: Request, { params }: { params: Promise<{ id: string }> }) => handleDelete(request, (await params).id, apiDeps());
