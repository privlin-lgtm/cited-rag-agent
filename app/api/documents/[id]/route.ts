import { handleDelete } from '../../../../lib/api';
import { apiDeps } from '../../../../lib/deps';

export const dynamic = 'force-dynamic';

export const DELETE = async (_request: Request, { params }: { params: Promise<{ id: string }> }) => handleDelete((await params).id, apiDeps());
