'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal, preload } from 'react-dom';
import { ElectionCockpit } from '../cockpit/cockpit';
import type { ElectionResponse, Geography } from '@/lib/tse/types';
import { BootShell, NeutralMap, PendingRegions } from './boot-shell';
import { NATIONAL_VIEW } from '../cockpit/map-navigation';
import { startEntryCountUp } from './entry-count-up';
export function FirstAccess({
  initial,
  regions,
  band,
  regionBoard,
  raceBoard,
}: {
  initial: ElectionResponse;
  regions: Geography[];
  /** Server-rendered 1st-round band shown above the panel. */
  band?: React.ReactNode;
  /** 1st-round "Por região" shown while there is no 2nd-round data. */
  regionBoard?: React.ReactNode;
  /** 1st-round left column shown while there is no 2nd-round data. */
  raceBoard?: React.ReactNode;
}) {
  const [boot, setBoot] = useState({ initial, regions }),
    [waiting, setWaiting] = useState(false),
    [painted, setPainted] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [countPhase, setCountPhase] = useState<'preparing' | 'running' | 'complete'>('preparing');
  const [camera, setCamera] = useState<{ view: number[]; uf: string }>({
    view: NATIONAL_VIEW,
    uf: '',
  });
  const [targets, setTargets] = useState<{ region: Element | null; map: Element | null }>({
    region: null,
    map: null,
  });
  const ready = !!boot.initial.snapshot && boot.regions.length > 0;
  [...(boot.initial.snapshot?.candidates ?? [])]
    .sort((a, b) => b.votes - a.votes)
    .slice(0, 2)
    .forEach((candidate) =>
      preload(`/api/election/photo/${candidate.id}`, { as: 'image', fetchPriority: 'high' }),
    );
  useEffect(() => {
    if (ready) return;
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const controllers = new Set<AbortController>();
    let received = { initial, regions };
    const request = async (url: string) => {
      const controller = new AbortController();
      controllers.add(controller);
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        return await response.json();
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
      }
    };
    const sync = async () => {
      await Promise.allSettled([
        received.initial.snapshot
          ? Promise.resolve()
          : request('/api/election/president?scope=br').then((result: ElectionResponse) => {
              if (!stopped && result.snapshot) {
                received = { ...received, initial: result };
                setBoot(received);
              }
            }),
        received.regions.length
          ? Promise.resolve()
          : request('/api/election/geography').then((catalog: { regions?: Geography[] }) => {
              if (!stopped && Array.isArray(catalog.regions) && catalog.regions.length) {
                received = { ...received, regions: catalog.regions };
                setBoot(received);
              }
            }),
      ]);
      if (stopped) return;
      setWaiting(!received.initial.snapshot || !received.regions.length);
      if (!received.initial.snapshot || !received.regions.length) timer = setTimeout(sync, 15000);
    };
    void sync();
    return () => {
      stopped = true;
      clearTimeout(timer);
      controllers.forEach((c) => c.abort());
    };
  }, [ready, initial, regions]);
  useEffect(() => {
    if (!ready || !root.current) return;
    return startEntryCountUp(root.current, setCountPhase);
  }, [ready]);
  useEffect(() => {
    if (!ready || !root.current) return;
    performance.mark('election-shell-interactive');
    performance.mark('election-data-visible');
    const region = root.current.querySelector('.region-sidebar'),
      map = root.current.querySelector('.map-panel');
    const frame = requestAnimationFrame(() => {
      setTargets({ region, map });
      const search = sessionStorage.getItem('first-access-search');
      const input = root.current?.querySelector<HTMLInputElement>('#territory-search');
      if (search && input) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          input,
          search,
        );
        input.dispatchEvent(new Event('input', { bubbles: true }));
        sessionStorage.removeItem('first-access-search');
      }
    });
    let finished = false,
      geometryMarked = false;
    const inspect = () => {
      if (finished) return;
      const mapNode = root.current?.querySelector<HTMLElement>('.cockpit-map');
      const view = mapNode?.dataset.view?.split(',').map(Number);
      const uf = new URLSearchParams(location.search).get('state')?.toLowerCase() ?? '';
      if (view?.length === 4 && view.every(Number.isFinite))
        setCamera((previous) =>
          previous.view.join(',') === view.join(',') && previous.uf === uf
            ? previous
            : { view, uf },
        );
      const canvas = root.current?.querySelector('canvas[data-visible-shapes]');
      const dataAvailable =
        !!root.current?.querySelector('.region-sidebar details') ||
        [...(root.current?.querySelectorAll('.map-callouts b,.context-counted') ?? [])].some(
          (node) => /\d/.test(node.textContent ?? ''),
        );
      if (canvas && Number(canvas.getAttribute('data-visible-shapes')) > 0) {
        if (!geometryMarked) {
          performance.mark('election-map-visible');
          geometryMarked = true;
        }
        if (!dataAvailable) return;
        finished = true;
        setPainted(true);
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(inspect);
    observer.observe(root.current, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['data-visible-shapes', 'data-view'],
    });
    inspect();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [ready]);
  if (!ready)
    return (
      <BootShell
        waiting={waiting}
        initial={boot.initial}
        band={band}
        regionBoard={regionBoard}
        raceBoard={raceBoard}
      />
    );
  return (
    <div
      className={`first-access-controller${initial.snapshot ? '' : ' first-access-enter'}`}
      ref={root}
      data-entry-counting={countPhase}
    >
      <ElectionCockpit initial={boot.initial} regions={boot.regions} band={band} />
      {targets.region && createPortal(<PendingRegions />, targets.region, 'pending-regions')}
      {targets.map &&
        createPortal(
          <div className="boot-map-cover" data-painted={painted} aria-hidden="true">
            <NeutralMap view={camera.view} uf={camera.uf} />
          </div>,
          targets.map,
          'neutral-entry-map',
        )}
    </div>
  );
}
