import { DurableObject } from 'cloudflare:workers';
import { WATCH_PROTOCOL, type CommitResult, type DeltaFile, type IndexFile } from '@pappdrive/protocol';
import type { Folder } from '../shared/bucket';
import type { Env } from '../shared/env';
import { commitCheckpoint, commitDelta } from './commit';
import { createSerialQueue } from './serial-queue';
import { deleteFolder, sweep } from './sweep';

const DAY_MS = 24 * 3600_000;
const CLOSE_POLICY_VIOLATION = 1008;

export class FolderQueue extends DurableObject<Env> {
  private readonly serial = createSerialQueue();

  private get folder(): Folder {
    const name = this.ctx.id.name;

    if (name === undefined) {
      throw new Error('FolderQueue was created without a name. Get it with env.FOLDER.getByName("<user>/<app>").');
    }

    const slash = name.indexOf('/');

    return { user: name.slice(0, slash), app: name.slice(slash + 1) };
  }

  async commitDelta(delta: DeltaFile, etag: string): Promise<CommitResult> {
    return this.serial(async () => this.announce(await commitDelta(this.env.BUCKET, this.folder, delta, etag)));
  }

  async commitCheckpoint(index: IndexFile, delta: DeltaFile, etag: string | null): Promise<CommitResult> {
    return this.serial(async () => this.announce(await commitCheckpoint(this.env.BUCKET, this.folder, index, delta, etag)));
  }

  private async announce(result: CommitResult): Promise<CommitResult> {
    if (!result.ok) {
      return result;
    }

    for (const ws of this.ctx.getWebSockets()) {
      ws.send(result.etag);
    }

    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    }

    return result;
  }

  fetch(): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);

    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': WATCH_PROTOCOL } });
  }

  webSocketMessage(ws: WebSocket): void {
    ws.close(CLOSE_POLICY_VIOLATION, 'The watch socket only carries messages from the server.');
  }

  async deleteFolder(): Promise<void> {
    return this.serial(async () => {
      await deleteFolder(this.env.BUCKET, this.folder);
      await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
    });
  }

  async alarm(): Promise<void> {
    return this.serial(async () => {
      if (await sweep(this.env.BUCKET, this.folder)) {
        await this.ctx.storage.setAlarm(Date.now() + DAY_MS);
      }
    });
  }
}
