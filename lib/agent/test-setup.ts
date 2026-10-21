import { migrate } from '../../scripts/migrate';
import { pgliteDb, type Db } from '../db';
import { fakeEmbedder } from '../fake-embedder';
import { ingestDocument } from '../ingest';

const documents = {
  'cancel.md':
    '# Cancellation\nA sender has 30 minutes to cancel a remittance transfer. The provider must refund the full amount. Fees are refunded too.\n\n# Errors\nThe sender has 180 days to report an error on a remittance transfer.',
  'sca.md':
    '# Authentication\nStrong customer authentication requires two independent elements of knowledge, possession and inherence.\n\n# Exemptions\nLow value payments may be exempt from strong customer authentication.',
  'settlement.md': '# Settlement\nMojaloop settlement windows group transfers between participants before the hub settles net positions.',
  'rule.txt': 'Section 1005.33 sets the procedures for resolving errors.\n\nA provider must investigate promptly.',
} as const;

export type Fixture = { db: Db; ids: Record<keyof typeof documents, string>; all: string[] };

export const setup = async (): Promise<Fixture> => {
  const db = await pgliteDb();
  await migrate(db);
  const ids = {} as Fixture['ids'];
  for (const [filename, text] of Object.entries(documents) as [keyof typeof documents, string][]) {
    await ingestDocument(db, fakeEmbedder, {
      collection: 'corpus',
      filename,
      kind: filename.endsWith('.md') ? 'md' : 'txt',
      data: new TextEncoder().encode(text),
    });
    ids[filename] = (await db.query<{ id: string }>('select id::text as id from documents where filename = $1', [filename]))[0].id;
  }
  return { db, ids, all: Object.values(ids) };
};
