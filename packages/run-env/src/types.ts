/** Program execution environment — a general abstraction for running programs
 *  and manipulating their filesystem, regardless of whether the program runs
 *  as web WASM, node WASI, or a native binary. */

/** A directory entry listing. */
export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

/** Result of. */
export interface StatInfo {
  size: number;
  isDirectory: boolean;
}

/** Path-based whole-file filesystem interface. Methods are async round-trips
 *  — each operation opens, performs the op, and closes. */
export interface Fs {
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  stat(path: string): Promise<StatInfo>;
  remove(path: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

/** Command to execute via {@link RunEnv.run}. */
export interface Command {
  /** Program to run. Interpretation is implementation-specific:
   *  - web WASM: resolved URL of the `.wasm` binary
   *  - node WASI: absolute path to the `.wasm` binary on the host
   *  - native: binary name (resolved via PATH) or absolute path */
  program: string;
  args: string[];
  env?: Record<string, string>;
}

/** Handle to a running command. */
export interface RunHandle {
  stdin: WritableStream<ArrayBuffer>;
  stdout: ReadableStream<ArrayBuffer>;
  stderr: ReadableStream<ArrayBuffer>;
  /** Resolves to the exit code. Killed by signal N → 128+N (POSIX convention). */
  exit: Promise<number>;
}

/** A program execution environment: provides filesystem access plus the
 *  ability to run commands. */
export interface RunEnv {
  /** Backend identifier (e.g. 'web-wasi', 'node-wasi', 'node-native'). */
  readonly name: string;
  readonly fs: Fs;
  run(cmd: Command): RunHandle;
  /** Terminate the execution environment */
  terminate(): void;
}
