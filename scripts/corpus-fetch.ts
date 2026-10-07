import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractText } from 'unpdf';
import { z } from 'zod';
import { corpusDir, manifestSchema, type ManifestDocument } from '../lib/corpus';

const MAX_BYTES = 20 * 1024 * 1024;
const PUBLIC_DOMAIN = 'Public domain (U.S. Government work, 17 U.S.C. §105)';
const CFPB = 'Consumer Financial Protection Bureau';
const MOJALOOP_SHA = 'cfa8f5187f7a27eaa406c564a4b129e3d3253cae';
const MOJALOOP_LICENCE = 'Apache-2.0';
const MOJALOOP_ATTRIBUTION = '© Mojaloop Foundation';
const PSD2_URL = 'https://publications.europa.eu/resource/cellar/dd85ef2e-a953-11e5-b528-01aa75ed71a1.0006.01/DOC_1';

const mojaloopUrl = (path: string) => `https://raw.githubusercontent.com/mojaloop/documentation/${MOJALOOP_SHA}/${path}`;

type Source = Omit<ManifestDocument, 'sha256' | 'sourceUrl'> & {
  load: () => Promise<{ bytes: Uint8Array; sourceUrl: string }>;
  check?: (bytes: Uint8Array) => Promise<void>;
};

const get = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

const direct = (url: string) => async () => ({ bytes: await get(url), sourceUrl: url });

const decodeEntities = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

export const ecfrXmlToText = (xml: string) =>
  `${[...xml.matchAll(/<(HEAD|P|CITA|SOURCE)\b[^>]*>([\s\S]*?)<\/\1>/g)]
    .map(([, , inner]) =>
      decodeEntities(inner.replace(/<\/?(?:I|E|SU|B)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n\n')}\n`;

const ecfrDate = async () => {
  const { titles } = z
    .object({ titles: z.array(z.object({ number: z.number(), up_to_date_as_of: z.string().nullable() })) })
    .parse(await (await fetch('https://www.ecfr.gov/api/versioner/v1/titles.json')).json());
  return z.iso.date().parse(titles.find((title) => title.number === 12)?.up_to_date_as_of);
};

const mojaloopPage = (id: string, title: string, path: string, filename: string): Source => ({
  id,
  title,
  filename: `mojaloop/${filename}`,
  kind: 'md',
  licence: MOJALOOP_LICENCE,
  licenceUrl: 'https://www.apache.org/licenses/LICENSE-2.0',
  attribution: MOJALOOP_ATTRIBUTION,
  note: `mojaloop/documentation at commit ${MOJALOOP_SHA}, path ${path}.`,
  load: direct(mojaloopUrl(path)),
});

export const sources = (date: string): Source[] => [
  {
    id: 'cfpb-small-entity-guide',
    title: 'CFPB Remittance Transfers Small Entity Compliance Guide (version 5.0)',
    filename: 'cfpb_remittance-transfers_small-entity-compliance-guide.pdf',
    kind: 'pdf',
    licence: PUBLIC_DOMAIN,
    attribution: CFPB,
    load: direct('https://files.consumerfinance.gov/f/documents/cfpb_remittance-transfers_small-entity-compliance-guide.pdf'),
  },
  {
    id: 'cfpb-exam-procedures',
    title: 'CFPB Remittance Transfer Rule Examination Procedures',
    filename: 'cfpb_remittance-transfer-examination-procedures.pdf',
    kind: 'pdf',
    licence: PUBLIC_DOMAIN,
    attribution: CFPB,
    load: direct('https://files.consumerfinance.gov/f/documents/cfpb_remittance-transfer-examination-procedures.pdf'),
  },
  {
    id: 'regulation-e-subpart-b',
    title: '12 CFR part 1005, subpart B (Regulation E, remittance transfers)',
    filename: 'regulation-e-subpart-b.txt',
    kind: 'txt',
    licence: PUBLIC_DOMAIN,
    attribution: 'eCFR (unofficial editorial compilation), Office of the Federal Register',
    note: `eCFR text as of ${date}, converted from the eCFR XML to plain text.`,
    load: async () => {
      const sourceUrl = `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-12.xml?part=1005&subpart=B`;
      return { bytes: new TextEncoder().encode(ecfrXmlToText(new TextDecoder().decode(await get(sourceUrl)))), sourceUrl };
    },
  },
  {
    id: 'psd2-directive-2015-2366',
    title: 'Directive (EU) 2015/2366 (PSD2)',
    filename: 'directive-eu-2015-2366-psd2.pdf',
    kind: 'pdf',
    licence: 'Reuse authorised under Commission Decision 2011/833/EU',
    licenceUrl: 'https://eur-lex.europa.eu/content/legal-notice/legal-notice.html',
    attribution: '© European Union, https://eur-lex.europa.eu/, 1998–2026. Only the Official Journal of the European Union is authentic.',
    note: "Same Official Journal text as EUR-Lex CELEX:32015L2366 (https://eur-lex.europa.eu/eli/dir/2015/2366/oj). Downloaded from the Publications Office's Cellar because EUR-Lex challenges scripted downloads.",
    load: direct(PSD2_URL),
    check: async (bytes) => {
      const { text } = await extractText(new Uint8Array(bytes), { mergePages: false });
      if (!text[0]?.includes('DIRECTIVE (EU) 2015/2366')) throw new Error(`${PSD2_URL}: first page does not read "DIRECTIVE (EU) 2015/2366"`);
    },
  },
  {
    ...mojaloopPage(
      'mojaloop-generic-transaction-patterns',
      'Mojaloop FSPIOP API: Generic Transaction Patterns',
      'docs/technical/api/fspiop/generic-transaction-patterns.md',
      'generic-transaction-patterns.md',
    ),
    licence: 'CC BY-ND 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
    attribution: 'Ericsson, Huawei, Mahindra-Comviva, Telepin, and the Bill & Melinda Gates Foundation',
    note: `mojaloop/documentation at commit ${MOJALOOP_SHA}, path docs/technical/api/fspiop/generic-transaction-patterns.md. This page's front matter says "Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0)", unlike the Apache-2.0 repository licence. The file is committed unmodified.`,
  },
  mojaloopPage(
    'mojaloop-account-lookup-service',
    'Mojaloop Account Lookup Service',
    'docs/technical/technical/account-lookup-service/README.md',
    'account-lookup-service.md',
  ),
  mojaloopPage(
    'mojaloop-transfers-bounded-context',
    'Mojaloop Transfers Bounded Context',
    'docs/technical/reference-architecture/boundedContexts/transfers/index.md',
    'transfers-bounded-context.md',
  ),
  mojaloopPage(
    'mojaloop-quoting-agreement-bounded-context',
    'Mojaloop Quoting and Agreement Bounded Context',
    'docs/technical/reference-architecture/boundedContexts/quotingAgreement/index.md',
    'quoting-agreement-bounded-context.md',
  ),
  mojaloopPage(
    'mojaloop-settlement-basic-concepts',
    'Mojaloop Settlement Basic Concepts',
    'docs/adoption/HubOperations/Settlement/settlement-basic-concepts.md',
    'settlement-basic-concepts.md',
  ),
];

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const verify = (kind: ManifestDocument['kind'], url: string, bytes: Uint8Array) => {
  const head = Buffer.from(bytes.subarray(0, 512)).toString('latin1');
  if (kind === 'pdf' ? !head.startsWith('%PDF') : /^\s*<(!doctype|html)/i.test(head))
    throw new Error(`${url} did not return a ${kind} file; it starts with ${JSON.stringify(head.slice(0, 60))}`);
};

const write = async (filename: string, bytes: Uint8Array) => {
  const url = new URL(`files/${filename}`, corpusDir);
  await mkdir(dirname(fileURLToPath(url)), { recursive: true });
  await writeFile(url, bytes);
};

export const fetchCorpus = async () => {
  const downloaded = [];
  for (const source of sources(await ecfrDate())) {
    const { load, check, ...entry } = source;
    const { bytes, sourceUrl } = await load();
    verify(entry.kind, sourceUrl, bytes);
    await check?.(bytes);
    downloaded.push({ entry: { ...entry, sourceUrl, sha256: sha256(bytes) }, bytes });
  }
  const licenceFileUrl = mojaloopUrl('LICENSE.md');
  const licenceBytes = await get(licenceFileUrl);
  verify('md', licenceFileUrl, licenceBytes);
  const total = downloaded.reduce((sum, { bytes }) => sum + bytes.length, licenceBytes.length);
  if (total > MAX_BYTES) throw new Error(`corpus is ${total} bytes, over the ${MAX_BYTES} byte limit`);
  for (const { entry, bytes } of downloaded) await write(entry.filename, bytes);
  await write('mojaloop/LICENSE.md', licenceBytes);
  const manifest = manifestSchema.parse({
    documents: downloaded.map(({ entry: { id, title, filename, kind, sourceUrl, licence, licenceUrl, attribution, sha256, note } }) => ({
      id,
      title,
      filename,
      kind,
      sourceUrl,
      licence,
      ...(licenceUrl && { licenceUrl }),
      attribution,
      sha256,
      ...(note && { note }),
    })),
    licenceFiles: [{ filename: 'mojaloop/LICENSE.md', sourceUrl: licenceFileUrl, sha256: sha256(licenceBytes) }],
  });
  await writeFile(new URL('manifest.json', corpusDir), `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, total, sizes: new Map(downloaded.map(({ entry, bytes }) => [entry.filename, bytes.length])) };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { manifest, total, sizes } = await fetchCorpus();
  for (const { filename, sha256 } of manifest.documents) console.log(`${filename}  ${sizes.get(filename)} bytes  ${sha256.slice(0, 12)}`);
  console.log(`${manifest.documents.length} documents, ${total} bytes (${(total / 1048576).toFixed(2)} MB)`);
  process.exit(0);
}
