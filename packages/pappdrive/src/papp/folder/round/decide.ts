import { baseName } from '../../../shared/paths.js';
import type { DiskRec, Rec } from '../shared/state.js';

export type Decision =
  | { key: string; action: 'download'; disk: DiskRec | undefined; server: Rec }
  | { key: string; action: 'delete-here'; disk: DiskRec }
  | { key: string; action: 'upload'; disk: DiskRec; server: Rec | undefined }
  | { key: string; action: 'delete-server'; server: Rec }
  | { key: string; action: 'conflict'; disk: DiskRec; server: Rec }
  | { key: string; action: 'adopt'; disk: DiskRec; server: Rec }
  | { key: string; action: 'forget' };

interface DecideInput {
  disk: Map<string, DiskRec>;
  synced: Map<string, Rec>;
  server: Map<string, Rec>;
  frozen: Set<string>;
  readOnly: boolean;
}

export function sameVersion(a: Rec, b: Rec): boolean {
  return a.entry.id === b.entry.id && baseName(a.path) === baseName(b.path);
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
