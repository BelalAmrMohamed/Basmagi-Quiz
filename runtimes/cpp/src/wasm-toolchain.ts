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
}

const ESUCCESS = 0;

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
  stdinStr = '';
  stdinStrPos = 0;
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

  setStdinStr(s: string) {
    this.stdinStr = s;
    this.stdinStrPos = 0;
  }

  addDirectory(path: string) {
    this.mem.check();
    this.mem.write(this.exports.GetPathBuf(), path);
    this.exports.AddDirectoryNode(path.length);
  }

  addFile(path: string, contents: ArrayBuffer | Uint8Array | string) {
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
      str += this.hostMem_.readStr(buf, len);
      size += len;
    }
    this.hostMem_.write32(nwritten_out, size);
    this.hostWrite(str);
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
      const lenToWrite = Math.min(len, this.stdinStr.length - this.stdinStrPos);
      if (lenToWrite === 0) break;
      this.hostMem_.write(buf, this.stdinStr.substring(this.stdinStrPos, this.stdinStrPos + lenToWrite));
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

  constructor(memfs: MemFS, name: string, ...args: string[]) {
    this.argv = [name, ...args];
    this.memfs = memfs;
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

  constructor(opts: ToolchainOptions) {
    this.opts = opts;
  }

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
    workspaceFiles: Array<{ name: string; content: string }> = []
  ): Promise<RunResult> {
    const started = Date.now();
    await this.prepare();

    let compileOutput = '';
    let runStdout = '';
    let runStderr = '';

    // Mount workspace text files into MemFS
    for (const f of workspaceFiles) {
      this.memfs.addFile(f.name, f.content);
    }

    // Write source file
    const inputFile = 'main.cpp';
    const objFile = 'main.o';
    const wasmFile = 'app.wasm';
    this.memfs.addFile(inputFile, code);

    // 1. Compile with Clang
    const clangHostWrite = (s: string) => { compileOutput += s; };
    const clangMemfs = new MemFS(clangHostWrite);
    clangMemfs.instance = this.memfs.instance;
    clangMemfs.exports = this.memfs.exports;
    clangMemfs.mem = this.memfs.mem;

    const clangArgs = [
      '-cc1', '-emit-obj',
      '-disable-free',
      '-isysroot', '/',
      '-internal-isystem', '/include/c++/v1',
      '-internal-isystem', '/include',
      '-internal-isystem', '/lib/clang/8.0.1/include',
      '-ferror-limit', '19',
      '-O0',
      '-o', objFile,
      '-x', 'c++', inputFile,
    ];

    const clangApp = new WasmApp(clangMemfs, 'clang', ...clangArgs);
    await clangApp.init(this.clangModule!);
    const compileExit = clangApp.run();

    if (compileExit !== 0) {
      return {
        ok: false,
        compile: compileOutput,
        stdout: '',
        stderr: '',
        exit: compileExit,
        timeMs: Date.now() - started,
        files: [],
      };
    }

    // 2. Link with LLD
    const lldHostWrite = (s: string) => { compileOutput += s; };
    const lldMemfs = new MemFS(lldHostWrite);
    lldMemfs.instance = this.memfs.instance;
    lldMemfs.exports = this.memfs.exports;
    lldMemfs.mem = this.memfs.mem;

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

    const lldApp = new WasmApp(lldMemfs, 'wasm-ld', ...lldArgs);
    await lldApp.init(this.lldModule!);
    const linkExit = lldApp.run();

    if (linkExit !== 0) {
      return {
        ok: false,
        compile: compileOutput || 'Linking error occurred.',
        stdout: '',
        stderr: '',
        exit: linkExit,
        timeMs: Date.now() - started,
        files: [],
      };
    }

    // 3. Run the compiled WebAssembly program
    const wasmBytes = this.memfs.getFileContents(wasmFile);
    if (!wasmBytes) {
      return {
        ok: false,
        compile: 'Failed to read compiled wasm binary.',
        stdout: '',
        stderr: '',
        exit: 1,
        timeMs: Date.now() - started,
        files: [],
      };
    }

    const runHostWrite = (s: string) => {
      runStdout += s;
      this.opts.onStdout?.(s);
    };
    this.memfs.hostWrite = runHostWrite;
    this.memfs.setStdinStr(stdin || '');

    const appModule = await WebAssembly.compile(wasmBytes.slice().buffer);
    const userApp = new WasmApp(this.memfs, wasmFile);
    await userApp.init(appModule);

    let runExit = 0;
    try {
      runExit = userApp.run();
    } catch (e: any) {
      runStderr += (e?.message || String(e)) + '\n';
      runExit = 1;
    }

    // Collect any workspace files that were written or modified during execution
    const resultingFiles: Array<{ name: string; content: string }> = [];
    for (const filename of this.memfs.createdFiles) {
      if (filename === inputFile || filename === objFile || filename === wasmFile) continue;
      if (filename.startsWith('include/') || filename.startsWith('lib/')) continue;
      const data = this.memfs.getFileContents(filename);
      if (data) {
        let text = '';
        for (let i = 0; i < data.length; i++) text += String.fromCharCode(data[i]);
        resultingFiles.push({ name: filename, content: text });
      }
    }

    return {
      ok: true,
      compile: compileOutput,
      stdout: runStdout,
      stderr: runStderr,
      exit: runExit,
      timeMs: Date.now() - started,
      files: resultingFiles,
    };
  }
}

