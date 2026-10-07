import { describe, expect, it } from 'vitest';
import { ecfrXmlToText } from './corpus-fetch';

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
