// Browser polyfills for Node globals that web3 deps (Privy/wagmi/viem/walletconnect) reference.
// esbuild `inject` replaces bare `Buffer`/`process` identifiers with these exports, and the side
// effects below also set them on globalThis for code that reads window.Buffer / globalThis.process.
import { Buffer as _Buffer } from "buffer";
import _process from "process";

export const Buffer = _Buffer;
export const process = _process;

if (typeof globalThis !== "undefined") {
  if (!globalThis.Buffer) globalThis.Buffer = _Buffer;
  if (!globalThis.process) globalThis.process = _process;
  if (!globalThis.global) globalThis.global = globalThis;
}
