/** One shared search thread; only the seat's redacted view crosses the boundary. */
import { Worker } from 'node:worker_threads';
import type { XmjAction, XmjPlayerView, XmjSeat } from '@mistboard/game';

// Plain JS deliberately imports the built game package, in both tsx dev and
// production. No TS loader or server/room state is needed inside the worker.
const SEARCH_SOURCE = `
const { parentPort } = require('node:worker_threads');
import(${JSON.stringify(import.meta.resolve('@mistboard/game'))}).then(({ xmjSearchBotAction }) => {
  parentPort.on('message', ({ id, view, seat }) => {
    try {
      parentPort.postMessage({ id, action: xmjSearchBotAction(view, seat) });
    } catch {
      parentPort.postMessage({ id, failed: true });
    }
  });
});
`;
const MAX_PENDING = 64;
const DEADLINE_MS = 10_000;

type Pending = {
  resolve(action: XmjAction | null): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
};

export class XmjBotSearchWorker {
  private worker: Worker | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  search(view: XmjPlayerView, seat: XmjSeat): Promise<XmjAction | null> {
    if (this.pending.size >= MAX_PENDING) {
      return Promise.reject(new Error('XMJ search queue full'));
    }
    const worker = this.worker ?? this.start();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(worker, new Error('XMJ search deadline')),
        DEADLINE_MS,
      );
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      worker.ref();
      try {
        worker.postMessage({ id, view, seat });
      } catch {
        this.fail(worker, new Error('XMJ search request failed'));
      }
    });
  }

  close(): void {
    if (this.worker) this.fail(this.worker, new Error('XMJ search stopped'));
  }

  private start(): Worker {
    const worker = new Worker(SEARCH_SOURCE, { eval: true });
    this.worker = worker;
    worker.on('message', (message: { id: number; action: XmjAction | null; failed?: boolean }) => {
      const job = this.pending.get(message.id);
      if (!job) return;
      this.pending.delete(message.id);
      clearTimeout(job.timer);
      if (message.failed) job.reject(new Error('XMJ search failed'));
      else job.resolve(message.action);
      if (this.pending.size === 0) worker.unref();
    });
    worker.on('error', () => this.fail(worker, new Error('XMJ search worker failed')));
    worker.on('exit', () => this.fail(worker, new Error('XMJ search worker exited')));
    worker.unref();
    return worker;
  }

  private fail(worker: Worker, error: Error): void {
    if (this.worker !== worker) return;
    this.worker = null;
    for (const job of this.pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    this.pending.clear();
    void worker.terminate();
  }
}

export const xmjBotSearchWorker = new XmjBotSearchWorker();
