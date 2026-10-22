import { baseName, pathProblem } from '../../../shared/paths.js';
import type { FsAdapter } from '../../../shared/platform.js';
import { isHard } from '../scan/ignore.js';
import { sameVersion, type DiskRec, type Rec, type ServerView } from '../state.js';

export type Decision =
  | { key: string; action: 'download'; disk: DiskRec | undefined; server: Rec }
  | { key: string; action: 'delete-here'; disk: DiskRec }
  | { key: string; action: 'upload'; disk: DiskRec; server: Rec | undefined }
  | { key: string; action: 'delete-server'; server: Rec }
  | { key: string; action: 'conflict'; disk: DiskRec; server: Rec }
  | { key: string; action: 'adopt'; disk: DiskRec; server: Rec }
  | { key: string; action: 'forget' };

interface DecideInput {
  disk: ReadonlyMap<string, DiskRec>;
  synced: ReadonlyMap<string, Rec>;
  server: ReadonlyMap<string, Rec>;
  frozen: Set<string>;
  readOnly: boolean;
}

export function frozenKeys(disk: ReadonlyMap<string, DiskRec>, view: ServerView, fs: FsAdapter): { frozen: Set<string>; skipped: string[] } {
  const frozen = new Set<string>();
  const skipped: string[] = [];

  for (const [key, d] of disk) {
    if (d.skipped) {
      frozen.add(key);
      skipped.push(d.path);
    }
  }

  for (const [key, v] of view.map) {
    if (frozen.has(key)) {
      continue;
    } else if (isHard(v.path)) {
      frozen.add(key);
    } else if (pathProblem(v.path) || v.path.split('/').some(seg => !fs.canCreate(seg))) {
      frozen.add(key);
      skipped.push(v.path);
    }
  }

  return { frozen, skipped: skipped.sort() };
}

export function decide(input: DecideInput): Decision[] {
  const { disk, synced, server, frozen, readOnly } = input;
  const keys = new Set<string>([...disk.keys(), ...synced.keys(), ...server.keys()]);
  const out: Decision[] = [];

  for (const key of keys) {
    if (frozen.has(key)) {
      continue;
    }

    const d = disk.get(key);
    const s = synced.get(key);
    const v = server.get(key);
    const decision = readOnly ? decideReadOnly(key, d, s, v) : decideOne(key, d, s, v);

    if (decision) {
      out.push(decision);
    }
  }

  return out;
}

function decideOne(key: string, d: DiskRec | undefined, s: Rec | undefined, v: Rec | undefined): Decision | null {
  if (!s) {
    if (d && v) {
      return { key, action: d.entry.id === v.entry.id ? 'adopt' : 'conflict', disk: d, server: v };
    } else if (d) {
      return { key, action: 'upload', disk: d, server: undefined };
    } else if (v) {
      return { key, action: 'download', disk: undefined, server: v };
    }

    return null;
  } else if (!d) {
    if (!v) {
      return { key, action: 'forget' };
    }

    return sameVersion(v, s) ? { key, action: 'delete-server', server: v } : { key, action: 'download', disk: undefined, server: v };
  } else if (!v) {
    return sameVersion(d, s) ? { key, action: 'delete-here', disk: d } : { key, action: 'upload', disk: d, server: undefined };
  }

  const diskChanged = !sameVersion(d, s);
  const serverChanged = !sameVersion(v, s);

  if (!diskChanged && !serverChanged) {
    return null;
  } else if (!diskChanged) {
    return { key, action: 'download', disk: d, server: v };
  } else if (!serverChanged) {
    return { key, action: 'upload', disk: d, server: v };
  }

  return { key, action: d.entry.id === v.entry.id ? 'adopt' : 'conflict', disk: d, server: v };
}

function decideReadOnly(key: string, d: DiskRec | undefined, s: Rec | undefined, v: Rec | undefined): Decision | null {
  if (v) {
    if (!d || d.entry.id !== v.entry.id) {
      return { key, action: 'download', disk: d, server: v };
    } else if (!s || !sameVersion(s, v) || baseName(d.path) !== baseName(v.path)) {
      return { key, action: 'adopt', disk: d, server: v };
    }

    return null;
  } else if (d) {
    return { key, action: 'delete-here', disk: d };
  } else if (s) {
    return { key, action: 'forget' };
  }

  return null;
}
