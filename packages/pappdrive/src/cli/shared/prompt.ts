import * as readline from 'node:readline';
import { Writable } from 'node:stream';
import { CliError } from './errors.js';

export interface Prompter {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
  close(): void;
}

export function createPrompter(): Prompter {
  const terminal = process.stdin.isTTY;
  let muted = false;
  const echo = new Writable({
    write(chunk, encoding, cb) {
      if (!muted) {
        process.stdout.write(chunk, encoding);
      }

      cb();
    },
  });
  Object.defineProperty(echo, 'columns', { get: () => (process.stdout as { columns?: number }).columns ?? 80 });
  const rl = readline.createInterface({ input: process.stdin, output: echo, terminal, historySize: 0 });
  const lines = rl[Symbol.asyncIterator]();
  let cancelled = false;
  rl.on('SIGINT', () => {
    muted = false;
    process.stdout.write('\n');
    cancelled = true;
    rl.close();
  });

  const nextLine = async (): Promise<string> => {
    const line = await lines.next();

    if (line.done) {
      throw new CliError(cancelled ? 'Cancelled.' : 'No more input: the questions could not be answered.', 130);
    }

    return line.value;
  };

  return {
    async ask(question) {
      if (terminal) {
        rl.setPrompt(question);
        rl.prompt();
      } else {
        process.stdout.write(question);
      }

      const answer = (await nextLine()).trim();

      if (!terminal) {
        process.stdout.write('\n');
      }

      return answer;
    },
    async askHidden(question) {
      process.stdout.write(question);
      muted = true;
      try {
        if (terminal) {
          rl.setPrompt('');
          rl.prompt();
        }

        return await nextLine();
      } finally {
        muted = false;
        process.stdout.write('\n');
      }
    },
    close() {
      rl.close();
    },
  };
}
