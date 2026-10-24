'use client';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import type { CandidateResult } from '@/lib/tse/types';
import { editorialName } from './editorial-name';
import { number, percent } from '@/lib/format';
export type TooltipMetric = {
  counted: number | null;
  validVotes?: number | null;
  candidates: {
    id?: string;
    number: string;
    name: string;
    percentage: number;
    votes: number;
    color: string;
  }[];
};
function Photo({ candidate, name }: { candidate?: CandidateResult; name: string }) {
  const [failed, setFailed] = useState(false);
  return candidate && !failed ? (
    <Image
      unoptimized
      width={32}
      height={36}
      src={`/api/election/photo/${candidate.id}`}
      alt={editorialName(name)}
      onError={() => setFailed(true)}
    />
  ) : (
    <span
      className="map-portrait-fallback"
      aria-label={`Foto indisponível: ${editorialName(name)}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
export function tooltipPosition(
  point: { x: number; y: number },
  viewport: number[],
  size: number[],
) {
  const [w, h] = size,
    [vw, vh] = viewport;
  return {
    left: Math.max(8, Math.min(vw - w - 8, point.x > vw / 2 ? point.x - w - 16 : point.x + 16)),
    top: Math.max(8, Math.min(vh - h - 8, point.y > vh / 2 ? point.y - h - 16 : point.y + 16)),
  };
}
export function MapTooltip({
  uf,
  name,
  code,
  point,
  viewport,
  metric,
  registry,
}: {
  uf: string;
  name: string;
  code: string;
  point: { x: number; y: number };
  viewport: number[];
  metric?: TooltipMetric;
  registry: CandidateResult[];
}) {
  const ref = useRef<HTMLDivElement>(null),
    [size, setSize] = useState([270, 230]);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([e]) =>
      setSize([
        e.borderBoxSize[0]?.inlineSize ?? node.offsetWidth,
        e.borderBoxSize[0]?.blockSize ?? node.offsetHeight,
      ]),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className="cockpit-tooltip pointer-tooltip electoral-tooltip"
      role="status"
      data-territory={code || uf}
      style={{ ...tooltipPosition(point, viewport, size), bottom: 'auto' }}
    >
      <header>
        <span className="tooltip-uf">{uf.toUpperCase()}</span>
        <div>
          <strong>{editorialName(name)}</strong>
          <small>
            {metric ? `${percent(metric.counted)}% das seções` : 'Resultado ainda não recebido'}
          </small>
        </div>
      </header>
      {metric ? (
        <>
          <div className="tooltip-candidates">
            {metric.candidates.slice(0, 2).map((c) => {
              const identity = registry.find((v) => v.number === c.number);
              return (
                <div className="tooltip-candidate" key={c.number}>
                  <Photo key={identity?.id ?? c.number} candidate={identity} name={c.name} />
                  <span>
                    <strong>{editorialName(c.name)}</strong>
                    <small>
                      {identity?.party ?? '—'} · {c.number}
                    </small>
                  </span>
                  <b>{percent(c.percentage)}%</b>
                </div>
              );
            })}
          </div>
          <dl>
            <dt>Diferença</dt>
            <dd>
              {percent(
                (metric.candidates[0]?.percentage ?? 0) - (metric.candidates[1]?.percentage ?? 0),
              )}{' '}
              p.p.
            </dd>
            <dt>Votos válidos</dt>
            <dd>{number(metric.validVotes)}</dd>
          </dl>
        </>
      ) : (
        <p>
          {code
            ? 'Sem dados deste município. O resultado estadual não é usado como substituto.'
            : 'Resultado deste estado ainda não recebido.'}
        </p>
      )}
    </div>
  );
}
