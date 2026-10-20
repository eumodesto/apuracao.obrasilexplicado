import { createHash } from 'node:crypto';
import { mkdir, readFile, appendFile } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';
import type { ElectionResponse } from './types';
import type { ElectionMapSnapshot } from './map-types';
import type { MunicipalMetric } from './municipal-map';
import { electionOf } from './urls';
const electionOfFrame = (f: CockpitFrame) => electionOf(f.national.snapshot?.sourceUrl ?? '');
export type CockpitFrame = {
  id: string;
  observedAt: string;
  national: ElectionResponse;
  map: ElectionMapSnapshot;
  municipalities: MunicipalMetric[];
};
export class CockpitHistory {
  private frames: CockpitFrame[] = [];
  private queue: Promise<void> = Promise.resolve();
  private loaded = false;
  durable = true;
  constructor(private directory: string) {}
  private async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const lines = (await readFile(path.join(this.directory, 'cockpit-history.jsonl'), 'utf8'))
        .split('\n')
        .filter(Boolean);
      for (const line of lines) {
        try {
          const f = JSON.parse(gunzipSync(Buffer.from(line, 'base64')).toString()) as CockpitFrame;
          if (
            typeof f.id === 'string' &&
            typeof f.observedAt === 'string' &&
            f.map?.states?.length === 27 &&
            f.national?.snapshot &&
            Array.isArray(f.municipalities)
          )
            this.frames.push(f);
        } catch {
          this.durable = false;
        }
      }
      this.frames = this.frames.slice(-90);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.durable = false;
    }
  }
  record(national: ElectionResponse, map: ElectionMapSnapshot, municipalities: MunicipalMetric[]) {
    this.queue = this.queue
      .then(async () => {
        await this.load();
        if (!national.snapshot) return;
        // A new election (2nd round) starts a new timeline; earlier frames stay on disk only.
        const election = electionOf(national.snapshot.sourceUrl);
        this.frames = this.frames.filter((f) => electionOfFrame(f) === election);
        const id = createHash('sha256')
          .update(
            JSON.stringify([
              national.snapshot.version,
              map.states.map((s) => [s.uf, s.version]),
              municipalities.map((m) => [m.uf, m.code, m.version]),
            ]),
          )
          .digest('hex')
          .slice(0, 20);
        if (this.frames.at(-1)?.id === id) return;
        const frame = { id, observedAt: new Date().toISOString(), national, map, municipalities };
        this.frames.push(frame);
        this.frames = this.frames.slice(-90);
        try {
          await mkdir(this.directory, { recursive: true });
          await appendFile(
            path.join(this.directory, 'cockpit-history.jsonl'),
            gzipSync(JSON.stringify(frame)).toString('base64') + '\n',
          );
        } catch {
          this.durable = false;
        }
      })
      .catch(() => {
        this.durable = false;
      });
    return this.queue;
  }
  async read() {
    await this.queue;
    await this.load();
    return [...this.frames];
  }
}
const runtime = globalThis as typeof globalThis & { cockpitHistory?: CockpitHistory };
export const cockpitHistory = (runtime.cockpitHistory ??= new CockpitHistory(
  path.resolve(/* turbopackIgnore: true */ process.env.TSE_CACHE_DIR || '.cache/tse'),
));
