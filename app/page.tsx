import { Workspace } from '../components/workspace';
import { appDb } from '../lib/db';
import { listDocuments } from '../lib/documents';
import { env } from '../lib/env';
import { sessionId } from '../lib/session';

export const dynamic = 'force-dynamic';

const examples = [
  'How long does a sender have to cancel a remittance transfer?',
  'What does PSD2 mean by strong customer authentication?',
  "In Mojaloop, how does a payer's FSP find which FSP holds the payee's account?",
  'What must a remittance provider disclose to the sender before they pay?',
];

export default async function Home() {
  const settings = env();
  return <Workspace env={settings.APP_ENV} examples={examples} initialDocuments={await listDocuments(appDb(), await sessionId({ create: false }))} />;
}
