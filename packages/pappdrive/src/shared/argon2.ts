import { argon2id } from 'hash-wasm';
import type { Argon2 } from './crypto.js';

export const hashWasmArgon2: Argon2 = (password, salt, params) =>
  argon2id({ password, salt, parallelism: params.p, iterations: params.t, memorySize: params.m, hashLength: 32, outputType: 'binary' });
