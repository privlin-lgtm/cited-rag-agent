import { describe, expect, it } from 'vitest';
import { loadManifest } from '../lib/corpus';
import { ecfrXmlToText, sources } from './corpus-fetch';

const fields = ({ id, title, filename, kind, licence, licenceUrl, attribution, note }: Awaited<ReturnType<typeof loadManifest>>['documents'][number]) => ({
  id,
  title,
  filename,
  kind,
  licence,
  licenceUrl,
  attribution,
  note,
});

describe('the committed manifest', () => {
  it('has the same fields that corpus:fetch writes, apart from hashes and download URLs', async () => {
    const { documents } = await loadManifest();
    const date = /as of (\d{4}-\d{2}-\d{2})/.exec(documents.find(({ id }) => id === 'regulation-e-subpart-b')?.note ?? '')?.[1] ?? '';
    expect(documents.map(fields)).toEqual(sources(date).map((source) => fields({ ...source, sourceUrl: 'https://example.test', sha256: '0'.repeat(64) })));
  });

  it('links every licence that is not public domain, and credits the CC BY-ND page to its authors', async () => {
    const { documents } = await loadManifest();
    for (const { id, licence, licenceUrl } of documents) expect(Boolean(licenceUrl), id).toBe(!licence.startsWith('Public domain'));
    const patterns = documents.find(({ id }) => id === 'mojaloop-generic-transaction-patterns');
    expect(patterns).toMatchObject({
      licence: 'CC BY-ND 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-nd/4.0/',
      attribution: 'Ericsson, Huawei, Mahindra-Comviva, Telepin, and the Bill & Melinda Gates Foundation',
    });
  });
});

const xml = `<?xml version="1.0"?>
<DIV6 N="B" TYPE="SUBPART" hierarchy_metadata="{&amp;quot;path&amp;quot;:&amp;quot;/on/x&amp;quot;}">
<HEAD>Subpart B&#x2014;Requirements for Remittance Transfers</HEAD>
<SOURCE>
<HED>Source:</HED><PSPACE>77 FR 6285, Feb. 7, 2012, unless otherwise noted.
</PSPACE></SOURCE>
<DIV8 N="1005.30" TYPE="SECTION">
<HEAD>&#xA7; 1005.30 Remittance transfer definitions.</HEAD>
<P>(a) &#x201C;Agent&#x201D; means an agent &amp; <I>others</I>, as defined under 12 CFR&#xA0;1005.</P>
<P>(b) Second   paragraph.</P>
<CITA TYPE="N">[77 FR 6285, Feb. 7, 2012]
</CITA>
</DIV8>
</DIV6>`;

describe('ecfrXmlToText', () => {
  it('keeps the subpart title, section headings and paragraphs, one blank line apart', () => {
    expect(ecfrXmlToText(xml)).toBe(
      [
        'Subpart B—Requirements for Remittance Transfers',
        'Source: 77 FR 6285, Feb. 7, 2012, unless otherwise noted.',
        '§ 1005.30 Remittance transfer definitions.',
        '(a) “Agent” means an agent & others, as defined under 12 CFR 1005.',
        '(b) Second paragraph.',
        '[77 FR 6285, Feb. 7, 2012]',
      ].join('\n\n') + '\n',
    );
  });

  it('leaves no tags or entities behind', () => {
    expect(ecfrXmlToText(xml)).not.toMatch(/<|&#|&amp;/);
  });
});
