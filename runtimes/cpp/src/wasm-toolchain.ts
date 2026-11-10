// =============================================================================
// runtimes/cpp/src/wasm-toolchain.ts
// In-browser C++ WebAssembly compiler and execution engine based on Clang + LLD + MemFS.
// Supports C++ Fundamentals, OOP, and virtual filesystem text file I/O (<fstream>).
// =============================================================================

export interface ToolchainOptions {
  getAssetBuffer: (name: string) => Promise<ArrayBuffer>;
  onStdout?: (s: string) => void;
  onStderr?: (s: string) => void;
}

export interface RunResult {
  ok: boolean;
  compile: string;
  stdout: string;
  stderr: string;
  exit: number;
  timeMs: number;
  files: Array<{ name: string; content: string }>;
  /** The program is waiting for interactive input (the run was abandoned at that read). */
  needInput?: boolean;
  /** The program crashed (a wasm trap); the kind lets the UI explain it in the learner's language. */
  trap?: 'stack' | 'oob' | 'div0' | 'abort' | 'badcall' | 'oom';
}

function trapKind(e: any): RunResult['trap'] | '' {
  const m = String(e?.message || e);
  if (/call stack|stack size/i.test(m)) return 'stack';
  if (/out of bounds|memory access/i.test(m)) return 'oob';
  if (/divide by zero|divide result unrepresentable|remainder by zero/i.test(m)) return 'div0';
  if (/unreachable/i.test(m)) return 'abort';
  if (/indirect call|null function|table index/i.test(m)) return 'badcall';
  if (/Invalid typed array length|out of memory|allocation/i.test(m)) return 'oom';
  return '';
}

export interface ExecuteOptions {
  /** Interactive stdin: `stdin` is everything typed so far; reading past it asks for more unless `eof`. */
  live?: boolean;
  eof?: boolean;
}

const ESUCCESS = 0;

/** Thrown from stdin reads when interactive input is needed and none is buffered; the run is abandoned and replayed with more input. */
export class NeedInput extends Error {
  constructor() { super('NEED_INPUT'); }
}

class ProcExit extends Error {
  code: number;
  constructor(code: number) {
    super(`Process exited with code ${code}`);
    this.code = code;
  }
}

function readStr(u8: Uint8Array, o: number, len = -1): string {
  let str = '';
  let end = u8.length;
  if (len !== -1) end = o + len;
  for (let i = o; i < end && u8[i] !== 0; ++i) str += String.fromCharCode(u8[i]);
  return str;
}

class WasmMemory {
  memory: WebAssembly.Memory;
  buffer: ArrayBuffer;
  u8: Uint8Array;
  u32: Uint32Array;

  constructor(memory: WebAssembly.Memory) {
    this.memory = memory;
    this.buffer = memory.buffer;
    this.u8 = new Uint8Array(this.buffer);
    this.u32 = new Uint32Array(this.buffer);
  }

  check() {
    if (this.buffer.byteLength === 0) {
      this.buffer = this.memory.buffer;
      this.u8 = new Uint8Array(this.buffer);
      this.u32 = new Uint32Array(this.buffer);
    }
  }

  read8(o: number) { return this.u8[o]; }
  read32(o: number) { return this.u32[o >> 2]; }
  write8(o: number, v: number) { this.u8[o] = v; }
  write32(o: number, v: number) { this.u32[o >> 2] = v; }
  write64(o: number, vlo: number, vhi = 0) { this.write32(o, vlo); this.write32(o + 4, vhi); }
  readStr(o: number, len = -1) { return readStr(this.u8, o, len); }

  writeStr(o: number, str: string) {
    o += this.write(o, str);
    this.write8(o, 0);
    return str.length + 1;
  }

  write(o: number, buf: ArrayBuffer | Uint8Array | string): number {
    if (buf instanceof ArrayBuffer) {
      return this.write(o, new Uint8Array(buf));
    } else if (typeof buf === 'string') {
      const arr = new Uint8Array(buf.length);
      for (let i = 0; i < buf.length; i++) arr[i] = buf.charCodeAt(i);
      return this.write(o, arr);
    } else {
      const dst = new Uint8Array(this.buffer, o, buf.length);
      dst.set(buf);
      return buf.length;
    }
  }
}

class MemFS {
  hostWrite: (s: string) => void;
  /** fd 2 output; falls back to hostWrite when unset. */
  hostWriteErr: ((s: string) => void) | null = null;
  stdinBytes = new Uint8Array(0);
  stdinStrPos = 0;
  /** Streaming UTF-8 decoders: unbuffered output arrives byte by byte, so a multi-byte character can span writes. */
  private decOut = new TextDecoder('utf-8');
  private decErr = new TextDecoder('utf-8');
  /** Files the user's program created or wrote (not clang/lld temp files); only filled while the program runs. */
  userWrites = new Set<string>();
  /** Interactive mode: reading past the buffered stdin asks the user instead of returning EOF. */
  stdinLive = false;
  stdinEof = false;
  hostMem_: WasmMemory | null = null;
  instance!: WebAssembly.Instance;
  exports: any;
  mem!: WasmMemory;
  createdFiles = new Set<string>();

  constructor(hostWrite: (s: string) => void) {
    this.hostWrite = hostWrite;
  }

  async init(memfsWasmBytes: ArrayBuffer) {
    const env = {
      abort: () => { throw new Error('MemFS abort'); },
      host_write: this.host_write.bind(this),
      host_read: this.host_read.bind(this),
      memfs_log: (buf: number, len: number) => {
        this.mem.check();
        console.log(this.mem.readStr(buf, len));
      },
      copy_in: this.copy_in.bind(this),
      copy_out: this.copy_out.bind(this),
    };

    const module = await WebAssembly.compile(memfsWasmBytes);
    this.instance = await WebAssembly.instantiate(module, { env });
    this.exports = this.instance.exports;
    this.mem = new WasmMemory(this.exports.memory);
    this.exports.init();
  }

  set hostMem(mem: WasmMemory) {
    this.hostMem_ = mem;
  }

  setStdinStr(s: string, live = false, eof = false) {
    this.stdinBytes = new TextEncoder().encode(s);
    this.stdinStrPos = 0;
    this.decOut = new TextDecoder('utf-8');
    this.decErr = new TextDecoder('utf-8');
    this.stdinLive = live;
    this.stdinEof = eof;
  }

  addDirectory(path: string) {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    this.exports.AddDirectoryNode(path.length);
  }

  addFile(path: string, contents: ArrayBuffer | Uint8Array | string) {
    if (typeof contents === 'string') contents = new TextEncoder().encode(contents); // bytes, so non-Latin text keeps its length
    const length = contents instanceof ArrayBuffer ? contents.byteLength : contents.length;
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    const inode = this.exports.AddFileNode(path.length, length);
    const addr = this.exports.GetFileNodeAddress(inode);
    this.mem.check();
    this.mem.write(addr, contents);
    this.createdFiles.add(path);
  }

  getFileContents(path: string): Uint8Array | null {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    const inode = this.exports.FindNode(path.length);
    if (!inode) return null;
    const addr = this.exports.GetFileNodeAddress(inode);
    const size = this.exports.GetFileNodeSize(inode);
    return new Uint8Array(this.mem.buffer, addr, size);
  }

  host_write(fd: number, iovs: number, iovs_len: number, nwritten_out: number): number {
    if (!this.hostMem_) return 0;
    this.hostMem_.check();
    let size = 0;
    let str = '';
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;
      str += (fd === 2 ? this.decErr : this.decOut).decode(this.hostMem_.u8.subarray(buf, buf + len), { stream: true });
      size += len;
    }
    this.hostMem_.write32(nwritten_out, size);
    if (fd === 2 && this.hostWriteErr) this.hostWriteErr(str); else this.hostWrite(str);
    return ESUCCESS;
  }

  host_read(fd: number, iovs: number, iovs_len: number, nread: number): number {
    if (!this.hostMem_) return 0;
    this.hostMem_.check();
    let size = 0;
    for (let i = 0; i < iovs_len; ++i) {
      const buf = this.hostMem_.read32(iovs);
      iovs += 4;
      const len = this.hostMem_.read32(iovs);
      iovs += 4;
      const lenToWrite = Math.min(len, this.stdinBytes.length - this.stdinStrPos);
      if (lenToWrite === 0) {
        if (size === 0 && this.stdinLive && !this.stdinEof) throw new NeedInput();
        break;
      }
      this.hostMem_.write(buf, this.stdinBytes.subarray(this.stdinStrPos, this.stdinStrPos + lenToWrite));
      size += lenToWrite;
      this.stdinStrPos += lenToWrite;
      if (lenToWrite !== len) break;
    }
    this.hostMem_.write32(nread, size);
    return ESUCCESS;
  }

  copy_out(clang_dst: number, memfs_src: number, size: number) {
    if (!this.hostMem_) return;
    this.hostMem_.check();
    const dst = new Uint8Array(this.hostMem_.buffer, clang_dst, size);
    this.mem.check();
    const src = new Uint8Array(this.mem.buffer, memfs_src, size);
    dst.set(src);
  }

  copy_in(memfs_dst: number, clang_src: number, size: number) {
    if (!this.hostMem_) return;
    this.mem.check();
    const dst = new Uint8Array(this.mem.buffer, memfs_dst, size);
    this.hostMem_.check();
    const src = new Uint8Array(this.hostMem_.buffer, clang_src, size);
    dst.set(src);
  }
}

class TarReader {
  u8: Uint8Array;
  offset = 0;

  constructor(buffer: ArrayBuffer) {
    this.u8 = new Uint8Array(buffer);
  }

  readStr(len: number) {
    const res = readStr(this.u8, this.offset, len);
    this.offset += len;
    return res;
  }

  readOctal(len: number) {
    return parseInt(this.readStr(len), 8) || 0;
  }

  alignUp() {
    this.offset = (this.offset + 511) & ~511;
  }

  readEntry() {
    if (this.offset + 512 > this.u8.length) return null;
    const filename = this.readStr(100);
    this.offset += 8 + 8 + 8; // mode, owner, group
    const size = this.readOctal(12);
    this.offset += 12 + 8; // mtim, checksum
    const type = this.readStr(1);
    this.offset += 100; // linkname

    if (this.readStr(8) !== 'ustar  ') return null;
    this.offset += 32 + 32 + 8 + 8 + 155; // ownerName, groupName, devMajor, devMinor, filenamePrefix
    this.alignUp();

    let contents: Uint8Array | undefined;
    if (type === '0') {
      contents = this.u8.subarray(this.offset, this.offset + size);
      this.offset += size;
      this.alignUp();
    }
    return { filename, type, contents };
  }

  untar(memfs: MemFS) {
    let entry;
    while ((entry = this.readEntry())) {
      if (entry.type === '0' && entry.contents) {
        memfs.addFile(entry.filename, entry.contents);
      } else if (entry.type === '5') {
        memfs.addDirectory(entry.filename);
      }
    }
  }
}

class WasmApp {
  argv: string[];
  environ: Record<string, string> = { USER: 'student', PWD: '/' };
  memfs: MemFS;
  instance!: WebAssembly.Instance;
  exports: any;
  mem!: WasmMemory;

  /** True for the learner's program (not clang/lld): file reads are clamped and writes are tracked. */
  userProgram = false;

  constructor(memfs: MemFS, name: string, ...args: string[]) {
    this.argv = [name, ...args];
    this.memfs = memfs;
  }

  /**
   * The memfs fd_read ignores the end of the file: libc++ asks for a 4 KB buffer, gets 4 KB back and keeps
   * reading whatever sits next to the file in memory (other headers). This shim clamps every read to the real
   * file size, and records the files the program creates or writes so the UI can show them.
   */
  private wrapFileIo(w: Record<string, any>) {
    const fsx: Record<string, any> = { ...this.memfs.exports };
    const open = new Map<number, { path: string; pos: number }>();
    const norm = (p: string) => p.replace(/^(\.?\/)+/, '');
    const sizeOf = (path: string) => this.memfs.getFileContents(path)?.length ?? 0;
    /** Shrink the iovec list to what the file can still supply. Returns the fixed iovec count (0 = at end of file) and the original lengths. */
    const clamp = (iovs: number, n: number, remain: number): { count: number; saved: number[] } => {
      const saved: number[] = [];
      let count = 0;
      for (let i = 0; i < n; i++) {
        const lenAt = iovs + i * 8 + 4;
        const len = this.mem.read32(lenAt);
        saved.push(len);
        const use = Math.min(len, remain);
        this.mem.write32(lenAt, use);
        remain -= use;
        if (use > 0) count = i + 1;
      }
      return { count, saved };
    };
    const restore = (iovs: number, saved: number[]) => saved.forEach((len, i) => this.mem.write32(iovs + i * 8 + 4, len));

    w.path_open = (...a: any[]) => {
      const r = fsx.path_open(...a);
      if (r === 0) {
        this.mem.check();
        const path = norm(this.mem.readStr(a[2], a[3]));
        open.set(this.mem.read32(a[8]), { path, pos: 0 });
        if ((Number(a[4]) & (1 | 8)) !== 0) this.memfs.userWrites.add(path); // O_CREAT | O_TRUNC
      }
      return r;
    };
    w.fd_close = (fd: number) => { open.delete(fd); return fsx.fd_close(fd); };
    w.fd_read = (fd: number, iovs: number, n: number, nreadPtr: number) => {
      const f = open.get(fd);
      if (!f) return fsx.fd_read(fd, iovs, n, nreadPtr);
      this.mem.check();
      const { count, saved } = clamp(iovs, n, Math.max(0, sizeOf(f.path) - f.pos));
      if (count === 0) { restore(iovs, saved); this.mem.write32(nreadPtr, 0); return ESUCCESS; } // end of file
      const r = fsx.fd_read(fd, iovs, count, nreadPtr);
      this.mem.check();
      restore(iovs, saved);
      if (r === 0) f.pos += this.mem.read32(nreadPtr);
      return r;
    };
    if (fsx.fd_pread) {
      w.fd_pread = (fd: number, iovs: number, n: number, offset: bigint | number, nreadPtr: number) => {
        const f = open.get(fd);
        if (!f) return fsx.fd_pread(fd, iovs, n, offset, nreadPtr);
        this.mem.check();
        const { count, saved } = clamp(iovs, n, Math.max(0, sizeOf(f.path) - Number(offset)));
        if (count === 0) { restore(iovs, saved); this.mem.write32(nreadPtr, 0); return ESUCCESS; }
        const r = fsx.fd_pread(fd, iovs, count, offset, nreadPtr);
        this.mem.check();
        restore(iovs, saved);
        return r;
      };
    }
    w.fd_seek = (fd: number, offset: bigint | number, whence: number, outPtr: number) => {
      const r = fsx.fd_seek(fd, offset, whence, outPtr);
      const f = open.get(fd);
      if (r === 0 && f) { this.mem.check(); f.pos = this.mem.read32(outPtr); }
      return r;
    };
    w.fd_write = (fd: number, iovs: number, n: number, nwrittenPtr: number) => {
      const r = fsx.fd_write(fd, iovs, n, nwrittenPtr);
      const f = open.get(fd);
      if (f) { this.mem.check(); this.memfs.userWrites.add(f.path); if (r === 0) f.pos += this.mem.read32(nwrittenPtr); }
      return r;
    };
    if (fsx.path_unlink_file) {
      w.path_unlink_file = (...a: any[]) => {
        const r = fsx.path_unlink_file(...a);
        if (r === 0) { this.mem.check(); this.memfs.userWrites.delete(norm(this.mem.readStr(a[1], a[2]))); }
        return r;
      };
    }
  }

  async init(module: WebAssembly.Module) {
    const wasi_unstable: Record<string, any> = {
      proc_exit: (code: number) => { throw new ProcExit(code); },
      environ_sizes_get: (countOut: number, bufSizeOut: number) => {
        this.mem.check();
        let size = 0;
        const names = Object.keys(this.environ);
        for (const k of names) size += k.length + this.environ[k].length + 2;
        this.mem.write64(countOut, names.length);
        this.mem.write64(bufSizeOut, size);
        return ESUCCESS;
      },
      environ_get: (ptrs: number, buf: number) => {
        this.mem.check();
        for (const k of Object.keys(this.environ)) {
          this.mem.write32(ptrs, buf);
          ptrs += 4;
          buf += this.mem.writeStr(buf, `${k}=${this.environ[k]}`);
        }
        this.mem.write32(ptrs, 0);
        return ESUCCESS;
      },
      args_sizes_get: (argcOut: number, argvBufSizeOut: number) => {
        this.mem.check();
        let size = 0;
        for (const a of this.argv) size += a.length + 1;
        this.mem.write64(argcOut, this.argv.length);
        this.mem.write64(argvBufSizeOut, size);
        return ESUCCESS;
      },
      args_get: (argvPtrs: number, argvBuf: number) => {
        this.mem.check();
        for (const a of this.argv) {
          this.mem.write32(argvPtrs, argvBuf);
          argvPtrs += 4;
          argvBuf += this.mem.writeStr(argvBuf, a);
        }
        this.mem.write32(argvPtrs, 0);
        return ESUCCESS;
      },
      random_get: (buf: number, len: number) => {
        const u8 = new Uint8Array(this.mem.buffer, buf, len);
        crypto.getRandomValues(u8);
        return ESUCCESS;
      },
      clock_time_get: (clockId: number, precision: bigint, timeOut: number) => {
        this.mem.check();
        const nowNs = BigInt(Date.now()) * 1_000_000n;
        this.mem.write32(timeOut, Number(nowNs & 0xffffffffn));
        this.mem.write32(timeOut + 4, Number((nowNs >> 32n) & 0xffffffffn));
        return ESUCCESS;
      },
      poll_oneoff: () => ESUCCESS,
    };

    // Merge MemFS WASI syscall implementations
    Object.assign(wasi_unstable, this.memfs.exports);
    if (this.userProgram) this.wrapFileIo(wasi_unstable);

    this.instance = await WebAssembly.instantiate(module, { wasi_unstable, env: {} });
    this.exports = this.instance.exports;
    this.mem = new WasmMemory(this.exports.memory);
    this.memfs.hostMem = this.mem;
  }

  run(): number {
    try {
      this.exports._start();
      return 0;
    } catch (e: any) {
      if (e instanceof ProcExit) return e.code;
      throw e;
    }
  }
}

export class Toolchain {
  private opts: ToolchainOptions;
  private memfs!: MemFS;
  private clangModule: WebAssembly.Module | null = null;
  private lldModule: WebAssembly.Module | null = null;
  private readyPromise: Promise<void> | null = null;
  /** Last successfully linked program, so replays with new stdin skip compile and link. */
  private lastCode = '';
  private lastWasm: Uint8Array | null = null;
  /** Workspace files already copied into MemFS, by name, with the content that was copied. */
  private mounted = new Map<string, string>();

  constructor(opts: ToolchainOptions) {
    this.opts = opts;
  }

  /** Load memfs + sysroot and compile clang/lld ahead of the first run. */
  warm(): Promise<void> { return this.prepare(); }

  private async prepare() {
    if (this.readyPromise) return this.readyPromise;

    this.readyPromise = (async () => {
      // 1. Initialize MemFS
      const memfsBytes = await this.opts.getAssetBuffer('memfs');
      this.memfs = new MemFS((s) => {
        this.opts.onStdout?.(s);
      });
      await this.memfs.init(memfsBytes);

      // 2. Untar Sysroot (C++ headers & standard libraries)
      const sysrootBytes = await this.opts.getAssetBuffer('sysroot.tar');
      const tar = new TarReader(sysrootBytes);
      tar.untar(this.memfs);
      this.memfs.createdFiles.clear(); // sysroot files are not user output

      // 3. Compile Clang & LLD WebAssembly modules
      const clangBytes = await this.opts.getAssetBuffer('clang');
      const lldBytes = await this.opts.getAssetBuffer('lld');
      const [clangMod, lldMod] = await Promise.all([
        WebAssembly.compile(clangBytes),
        WebAssembly.compile(lldBytes),
      ]);
      this.clangModule = clangMod;
      this.lldModule = lldMod;
    })();

    return this.readyPromise;
  }

  async execute(
    code: string,
    stdin: string,
    workspaceFiles: Array<{ name: string; content: string }> = [],
    xo: ExecuteOptions = {}
  ): Promise<RunResult> {
    const started = Date.now();
    const t0 = performance.now();
    await this.prepare();
    const tPrep = performance.now();

    let compileOutput = '';
    let runStdout = '';
    let runStderr = '';

    // Mount workspace text files into MemFS (only when new or edited, so repeated runs don't pile up copies)
    for (const f of workspaceFiles) {
      if (this.mounted.get(f.name) === f.content) continue;
      this.memfs.addFile(f.name, f.content);
      this.mounted.set(f.name, f.content);
    }

    const inputFile = 'main.cpp';
    const objFile = 'main.o';
    const wasmFile = 'app.wasm';
    const fail = (exit: number, compile: string): RunResult => ({
      ok: false, compile, stdout: '', stderr: '', exit, timeMs: Date.now() - started, files: [],
    });

    let tCompile = tPrep, tLink = tPrep;
    let wasmBytes: Uint8Array | null = null;

    if (code === this.lastCode && this.lastWasm) {
      // Replay (interactive input): same program, new stdin.
      wasmBytes = this.lastWasm;
    } else {
      this.lastCode = '';
      this.lastWasm = null;
      this.memfs.addFile(inputFile, code);

      // 1. Compile with Clang
      // One MemFS for every phase: the memfs wasm module's host callbacks are bound to this instance,
      // so a second MemFS object would never get its hostMem attached and file copies would silently do nothing.
      this.memfs.hostWrite = (s: string) => { compileOutput += s; };
      this.memfs.hostWriteErr = null;

      const clangArgs = [
        '-cc1', '-emit-obj',
        '-disable-free',
        '-isysroot', '/',
        '-internal-isystem', '/include/c++/v1',
        '-internal-isystem', '/include',
        '-internal-isystem', '/lib/clang/8.0.1/include',
        '-ferror-limit', '19',
        '-Wuninitialized', // the classic beginner bug: reading a variable before giving it a value
        '-O0',
        '-o', objFile,
        '-x', 'c++', inputFile,
      ];

      const clangApp = new WasmApp(this.memfs, 'clang', ...clangArgs);
      await clangApp.init(this.clangModule!);
      const compileExit = clangApp.run();
      tCompile = performance.now();
      if (compileExit !== 0) return fail(compileExit, compileOutput);

      // 2. Link with LLD
      this.memfs.hostWrite = (s: string) => { compileOutput += s; };
      this.memfs.hostWriteErr = null;

      const libdir = 'lib/wasm32-wasi';
      const crt1 = `${libdir}/crt1.o`;
      const lldArgs = [
        '--no-threads',
        '--export-dynamic',
        '-z', 'stack-size=1048576',
        `-L${libdir}`,
        crt1, objFile,
        '-lc', '-lc++', '-lc++abi',
        '-o', wasmFile,
      ];

      const lldApp = new WasmApp(this.memfs, 'wasm-ld', ...lldArgs);
      await lldApp.init(this.lldModule!);
      const linkExit = lldApp.run();
      tLink = performance.now();
      if (linkExit !== 0) return fail(linkExit, compileOutput || 'Linking error occurred.');

      const out = this.memfs.getFileContents(wasmFile);
      if (!out) return fail(1, 'Failed to read compiled wasm binary.');
      wasmBytes = out.slice(); // own copy: memfs memory can grow or be reused
      this.lastCode = code;
      this.lastWasm = wasmBytes;
    }

    // 3. Run the compiled WebAssembly program
    const runHostWrite = (s: string) => {
      runStdout += s;
      this.opts.onStdout?.(s);
    };
    this.memfs.hostWrite = runHostWrite;
    this.memfs.hostWriteErr = (s: string) => { runStderr += s; this.opts.onStderr?.(s); };
    this.memfs.setStdinStr(stdin || '', !!xo.live, !!xo.eof);

    const appModule = await WebAssembly.compile(wasmBytes.slice().buffer);
    const userApp = new WasmApp(this.memfs, wasmFile);
    userApp.userProgram = true;
    this.memfs.userWrites.clear();
    await userApp.init(appModule);

    let runExit = 0;
    let needInput = false;
    let trap: RunResult['trap'] | '' = '';
    try {
      runExit = userApp.run();
    } catch (e: any) {
      if (e instanceof NeedInput) needInput = true;
      else { trap = trapKind(e); if (!trap) runStderr += (e?.message || String(e)) + '\n'; runExit = 1; }
    }
    this.memfs.setStdinStr('');
    console.log(`[cpp-wasm] prepare ${Math.round(tPrep - t0)}ms · clang ${Math.round(tCompile - tPrep)}ms · lld ${Math.round(tLink - tCompile)}ms · run ${Math.round(performance.now() - Math.max(tLink, tCompile, tPrep))}ms${needInput ? ' · waiting for input' : ''}`);

    // Files the program created, plus mounted files whose content changed
    const resultingFiles: Array<{ name: string; content: string }> = [];
    const dec = new TextDecoder('utf-8');
    for (const name of new Set([...this.memfs.userWrites, ...this.mounted.keys()])) {
      if (name === inputFile || name === objFile || name === wasmFile) continue;
      if (/^(include|lib|share)\//.test(name)) continue;
      const data = this.memfs.getFileContents(name);
      if (!data) continue;
      const text = dec.decode(data);
      if (this.mounted.get(name) !== text) { resultingFiles.push({ name, content: text }); this.mounted.set(name, text); }
    }

    return {
      ok: true,
      compile: compileOutput,
      stdout: runStdout,
      stderr: runStderr,
      exit: runExit,
      timeMs: Date.now() - started,
      files: resultingFiles,
      ...(needInput ? { needInput: true } : {}),
      ...(trap ? { trap } : {}),
    };
  }
}
