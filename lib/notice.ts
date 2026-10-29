export type Notice = { message: string; limit: boolean };

const dayKey = (date: Date, timeZone?: string) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export const resetSentence = (resetsAt: Date, now: Date, { locale, timeZone }: { locale?: string; timeZone?: string } = {}) => {
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(resetsAt);
  const days = Math.round((Date.parse(dayKey(resetsAt, timeZone)) - Date.parse(dayKey(now, timeZone))) / 86_400_000);
  if (days <= 0) return `You can try again at ${time}.`;
  if (days === 1) return `You can try again tomorrow at ${time}.`;
  return `You can try again on ${new Intl.DateTimeFormat(locale, { timeZone, weekday: 'long' }).format(resetsAt)} at ${time}.`;
};
