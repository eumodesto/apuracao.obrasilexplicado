'use client';
import { useEffect, useState } from 'react';
import { displayName } from '@/features/landing/round-band-model';
import './governor-board.css';

type GovernorCandidate = {
  id: string;
  number: string;
  name: string;
  party: string;
  votes: number;
  percentage: number | null;
  color: string;
  elected: boolean;
};
type GovernorRace = {
  uf: string;
  name: string;
  stale: boolean;
  status: 'waiting' | 'counting' | 'finished' | 'unavailable';
  counted: number | null;
  candidates: GovernorCandidate[];
};
type Payload = { turn: string | null; races: GovernorRace[] };

/** Party colors the map palette has no entry for (it falls back to slate). */
const FALLBACK = ['#d9a441', '#8fa3bf'];
const NEUTRAL = '#64748B';
const pct = (value: number | null) =>
  value == null
    ? '—'
    : `${new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value)}%`;
const counted = (value: number | null) =>
  value == null ? '—' : `${Number.isInteger(value) ? value : pct(value).replace('%', '')}%`;

/** Polls the governor runoffs like the national result: every few seconds, with ETag. */
function useGovernors() {
  const [data, setData] = useState<Payload | null>(null);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>,
      etag = '';
    const poll = async () => {
      let delay = 3000;
      if (!document.hidden)
        try {
          const response = await fetch('/api/election/governors', {
            headers: etag ? { 'If-None-Match': etag } : {},
          });
          delay = Math.max(3000, Number(response.headers.get('X-Poll-After')) || 3000);
          if (response.status === 200) {
            etag = response.headers.get('ETag') ?? '';
            const next: Payload = await response.json();
            if (!stopped) setData(next);
          }
        } catch {
          delay = 10000;
        }
      else delay = 10000;
      if (!stopped) timer = setTimeout(poll, delay);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);
  return data;
}

/** Governor runoffs: per state, both candidates with photo, share and a bar split at 50%. */
export function GovernorBoard() {
  const data = useGovernors();
  if (!data?.races.length) return null;
  return (
    <section className="governor-board" aria-label="Governadores no 2º turno">
      <h2>
        Governadores
        <small>{data.turn ? `${data.turn}º turno` : '2º turno'}</small>
      </h2>
      <div className="gb-scroll">
        <ul>
          {data.races.map((race) => (
            <Race key={race.uf} race={race} />
          ))}
        </ul>
      </div>
    </section>
  );
}

function Race({ race }: { race: GovernorRace }) {
  const pair = race.candidates.slice(0, 2).map((c, i) => ({
    ...c,
    color: c.color === NEUTRAL ? FALLBACK[i] : c.color,
  }));
  const [a, b] = pair;
  const status =
    race.status === 'finished'
      ? 'apuração encerrada'
      : race.status === 'counting'
        ? `${counted(race.counted)} apurado`
        : 'aguardando apuração';
  return (
    <li className="gb-race">
      <div className="gb-head">
        <b>{race.name}</b>
        <small>{status}</small>
      </div>
      {pair.map((candidate) => (
        <div
          key={candidate.id}
          className={candidate.elected ? 'gb-candidate is-elected' : 'gb-candidate'}
          style={{ '--side': candidate.color } as React.CSSProperties}
        >
          <span className="gb-photo">
            {/* Decorative: the name is written next to it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/election/photo/${candidate.id}`}
              alt=""
              width={24}
              height={24}
              loading="lazy"
            />
          </span>
          <span className="gb-name">
            {displayName(candidate.name)}
            <small>{candidate.party}</small>
          </span>
          <strong>
            {candidate.elected && <span className="gb-elected">Eleito</span>}
            {pct(candidate.percentage)}
          </strong>
        </div>
      ))}
      {a && b && (
        <div className="gb-bar" aria-hidden="true">
          <i style={{ width: `${a.percentage ?? 0}%`, background: a.color }} />
          <i style={{ width: `${b.percentage ?? 0}%`, background: b.color }} />
          <em />
        </div>
      )}
    </li>
  );
}
