import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { loadManifest, readCorpusFile } from '../lib/corpus';
import { postgresDb, type Db } from '../lib/db';
import { createEmbedder, type Embedder } from '../lib/embed';
import { ingestDocument, type IngestReport } from '../lib/ingest';

export type CorpusReport = { filename: string } & IngestReport;

export const ingestCorpus = async (db: Db, embed: Embedder, onReport?: (report: CorpusReport) => void) => {
  const reports: CorpusReport[] = [];
  for (const { filename, kind } of (await loadManifest()).documents) {
    const report = {
      filename,
      ...(await ingestDocument(db, embed, { collection: 'corpus', filename, kind, data: await readCorpusFile(filename) })),
    };
    reports.push(report);
    onReport?.(report);
  }
  return reports;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { DATABASE_URL, VOYAGE_API_KEY } = z.object({ DATABASE_URL: z.url(), VOYAGE_API_KEY: z.string().min(1) }).parse(process.env);
  const reports = await ingestCorpus(postgresDb(DATABASE_URL), createEmbedder({ apiKey: VOYAGE_API_KEY }), (report) =>
    console.log(
      report.filename.padEnd(62),
      report.status.padEnd(9),
      `pages ${report.status === 'ingested' ? (report.pages ?? '-') : '-'}`.padEnd(9),
      `chunks ${report.chunks}`.padEnd(11),
      report.status === 'ingested' ? `voyage tokens ${report.tokens}` : '',
    ),
  );
  console.log(`${reports.filter(({ status }) => status === 'ingested').length} ingested, ${reports.filter(({ status }) => status === 'skipped').length} skipped`);
  process.exit(0);
}
