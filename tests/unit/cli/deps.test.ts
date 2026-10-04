import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { defaultMcpDeps } from "../../../src/cli/mcp/deps";

const ECHO_ARGS = "process.stdout.write(JSON.stringify(process.argv.slice(1)))";
const onWindows = process.platform === "win32" ? it : it.skip;
const offWindows = process.platform === "win32" ? it.skip : it;

describe("defaultMcpDeps().exec", () => {
  const { exec } = defaultMcpDeps();

  it("answers 127 for a command that does not exist", async () => {
    const result = await exec(`plane-no-such-command-${process.pid}`, ["--version"]);
    expect(result.code).toBe(127);
  });

  it("passes arguments with spaces, quotes and shell metacharacters through intact", async () => {
    const result = await exec(process.execPath, ["-e", ECHO_ARGS, "a b", 'c"d', "e&f"]);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(["a b", 'c"d', "e&f"]);
  });

  it("gives up after timeoutMs with code 124", async () => {
    const started = Date.now();
    const result = await exec(process.execPath, ["-e", "setTimeout(() => {}, 30000)"], { timeoutMs: 300 });
    expect(result.code).toBe(124);
    expect(Date.now() - started).toBeLessThan(5000);
  });

  offWindows("lets the process exit after a timeout even while a grandchild still holds the pipes", async () => {
    // `sh -c "sleep 8; true"` keeps sh as a wrapper, as cmd.exe is for every .cmd shim on Windows.
    const program = [
      "const { defaultMcpDeps } = require('./src/cli/mcp/deps');",
      "defaultMcpDeps().exec('sh', ['-c', 'sleep 8; true'], { timeoutMs: 300 })",
      "  .then((result) => process.stdout.write(`${result.code} ${Date.now()}`));",
    ].join("\n");
    const child = spawn(process.execPath, ["-r", "ts-node/register/transpile-only", "-e", program], {
      cwd: path.join(__dirname, "..", "..", ".."),
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    const exitedAt = await new Promise<number>((resolve) => child.on("exit", () => resolve(Date.now())));
    const [code, resolvedAt] = stdout.split(" ").map(Number);
    expect(code).toBe(124);
    expect(exitedAt - resolvedAt).toBeLessThan(3000);
  });

  onWindows("runs a .cmd shim, which plain execFile refuses since Node 20.12", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plane-deps-"));
    const shim = path.join(dir, "echo-args.cmd");
    fs.writeFileSync(shim, `@"${process.execPath}" -e "${ECHO_ARGS}" %*\r\n`);
    try {
      const result = await exec(shim, ["a b", "e&f"]);
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout)).toEqual(["a b", "e&f"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
