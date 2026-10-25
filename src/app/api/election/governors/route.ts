import { createHash } from 'node:crypto';
import { withAccess } from '@/lib/access/guard';
import { candidateColor } from '@/lib/tse/candidate-colors';
import { governorRaces } from '@/lib/tse/governors';
import { CLIENT_POLL_MS } from '@/lib/tse/service';
import { validVoteAnalysis } from '@/lib/tse/analysis';
import { encodeBody, respondBody, sharedValue } from '@/lib/tse/snapshot-response';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Same for every viewer: one build per window (the TSE moves ~30 s). */
const SHARED_MS = 2_000;

async function build() {
  const { races, turn } = await governorRaces();
  const body = {
    turn,
    races: races.map((race) => {
      const snapshot = race.snapshot;
      const analysis = validVoteAnalysis(snapshot);
      return {
        uf: race.uf,
        name: race.name,
        stale: race.stale,
        status: snapshot?.status ?? 'unavailable',
        counted: snapshot?.progress.percentageCounted ?? null,
        updatedAt: snapshot ? (snapshot.progress.totaledAt ?? snapshot.progress.generatedAt) : null,
        candidates: (snapshot?.candidates ?? []).map((c) => ({
          id: c.id,
          number: c.number,
          name: c.ballotName,
          party: c.party,
          votes: c.votes,
          // Shares of valid votes only once the official totals add up.
          percentage: analysis?.candidates.find((a) => a.id === c.id)?.percentage ?? null,
          color: candidateColor(c),
          elected: c.elected,
        })),
      };
    }),
  };
  const text = JSON.stringify(body);
  return encodeBody(text, '"' + createHash('sha256').update(text).digest('hex') + '"', {
    'Cache-Control': 'private, no-cache',
    'X-Poll-After': String(CLIENT_POLL_MS),
  });
}

/** Governor runoffs of the active round, summarized for the panel. */
async function get(request: Request) {
  try {
    return respondBody(request, await sharedValue('governors', SHARED_MS, build));
  } catch {
    console.error('[TSE] governor service failure');
    return Response.json({ error: 'Não foi possível consultar a fonte oficial.' }, { status: 503 });
  }
}
export const GET = withAccess(get);
