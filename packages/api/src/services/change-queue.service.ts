import { ulid } from 'ulid';
import { processCatalogChange } from './extraction.service.js';

export interface ChangeEvent {
  id: string;
  sourceType: 'resume' | 'application';
  sourceId: string;
  changeType: 'created' | 'updated' | 'deleted';
  timestamp: string;
  metadata?: Record<string, unknown>;
}

const DEBOUNCE_MS = 5000;

const pending = new Map<string, ChangeEvent>();
let timer: NodeJS.Timeout | null = null;

export function enqueueChange(
  sourceType: ChangeEvent['sourceType'],
  sourceId: string,
  changeType: ChangeEvent['changeType'],
  metadata?: Record<string, unknown>
): void {
  const key = `${sourceType}:${sourceId}`;
  pending.set(key, {
    id: ulid(),
    sourceType,
    sourceId,
    changeType,
    timestamp: new Date().toISOString(),
    metadata,
  });
  scheduleProcess();
}

function scheduleProcess(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void flush();
  }, DEBOUNCE_MS);
}

export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const events = [...pending.values()];
  pending.clear();
  for (const event of events) {
    try {
      await processCatalogChange(event);
    } catch (err) {
      console.error('[change-queue] Failed to process event', event.id, err);
    }
  }
}
