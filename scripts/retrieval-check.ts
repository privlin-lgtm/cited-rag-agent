import { z } from 'zod';
import { postgresDb } from '../lib/db';
import { createEmbedder } from '../lib/embed';
import { keywordSearch, semanticSearch, type Hit } from '../lib/search';

const GUIDE = 'cfpb_remittance-transfers_small-entity-compliance-guide.pdf';
const TABLE_PAGES = ['p. 17', 'p. 24'];
const CHECKS = [
  { question: 'How long does a sender have to cancel a remittance transfer?', terms: 'cancel remittance transfer' },
  { question: 'What is strong customer authentication?', terms: 'strong customer authentication' },
  { question: 'What are the phases of a Mojaloop transfer?', terms: 'Mojaloop transfer phases' },
];

const show = (label: string, hits: Hit[]) => {
  console.log(`  ${label}`);
  if (!hits.length) console.log('    (no hits)');
  hits.forEach((hit, i) =>
    console.log(`    ${i + 1}. ${hit.filename} · ${hit.locator} · ${hit.score.toFixed(3)}\n       ${hit.content.replace(/\s+/g, ' ').slice(0, 100)}`),
  );
};

const { DATABASE_URL, VOYAGE_API_KEY } = z.object({ DATABASE_URL: z.url(), VOYAGE_API_KEY: z.string().min(1) }).parse(process.env);
const db = postgresDb(DATABASE_URL);
const { embeddings, tokens } = await createEmbedder({ apiKey: VOYAGE_API_KEY })(
  CHECKS.map(({ question }) => question),
  'query',
);
console.log(`query embeddings used ${tokens} Voyage tokens`);

for (const [i, { question, terms }] of CHECKS.entries()) {
  console.log(`\nQ: ${question}`);
  show('semantic, top 3', await semanticSearch(db, embeddings[i], { k: 3 }));
  show(`keyword "${terms}", top 3`, await keywordSearch(db, terms, { k: 3 }));
}

for (const page of TABLE_PAGES) {
  const [chunk] = await db.query<{ id: string; ord: number; locator: string; content: string }>(
    `select c.id::text as id, c.ord, c.locator, c.content from chunks c join documents d on d.id = c.document_id
     where d.collection = 'corpus' and d.filename = $1 and c.locator = $2 order by c.ord limit 1`,
    [GUIDE, page],
  );
  console.log(`\n--- ${GUIDE} · ${chunk.locator} · chunk ${chunk.id} (ord ${chunk.ord}) ---\n${chunk.content}`);
}
process.exit(0);
