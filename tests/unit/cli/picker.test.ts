import { PassThrough } from "node:stream";
import { PickerChoice, multiSelect, splitKeys, textInput } from "../../../src/cli/mcp/picker";

const UP = "\x1b[A";
const DOWN = "\x1b[B";

/** A fake raw-mode terminal; `keys` are queued before the picker starts reading. */
function terminal(keys: string[]) {
  const input = Object.assign(new PassThrough(), {
    isRaw: false,
    rawModes: [] as boolean[],
    setRawMode(mode: boolean) {
      this.rawModes.push(mode);
      this.isRaw = mode;
    },
  });
  const output = new PassThrough();
  let written = "";
  output.on("data", (chunk: Buffer) => (written += chunk.toString()));
  for (const key of keys) input.write(key);
  // oxlint-disable-next-line no-control-regex -- strips the picker's ANSI codes
  return { input, output, text: () => written.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "") };
}

const CHOICES: PickerChoice[] = [
  { label: "Claude Code", hint: "2.1.4", checked: true },
  { label: "Codex", hint: "not found", disabled: true },
  { label: "OpenCode", hint: "v2.0.14", checked: true },
];

describe("splitKeys", () => {
  it("keeps escape sequences whole and splits the rest per character", () => {
    expect(splitKeys(`${UP} a\r\x1b`)).toEqual([UP, " ", "a", "\r", "\x1b"]);
  });
});

describe("multiSelect", () => {
  it("submits the pre-checked rows on enter and leaves a summary", async () => {
    const term = terminal(["\r"]);
    await expect(multiSelect("Install into:", CHOICES, term)).resolves.toEqual([0, 2]);
    expect(term.text()).toContain("✔ Install into: Claude Code, OpenCode");
    expect(term.input.rawModes).toEqual([true, false]);
  });

  it("moves past disabled rows, toggles with space and wraps around", async () => {
    // Down skips Codex to OpenCode; space unchecks it; down wraps to Claude Code; space unchecks it; up
    // wraps back to OpenCode; space checks it again.
    const term = terminal([DOWN, " ", DOWN, " ", UP, " ", "\r"]);
    await expect(multiSelect("Install into:", CHOICES, term)).resolves.toEqual([2]);
  });

  it("toggles every enabled row with `a`, never a disabled one", async () => {
    const term = terminal(["a", "\r", "a", "\r"]);
    // First `a` unchecks both (they were all checked), enter is refused; second `a` checks both.
    await expect(multiSelect("Install into:", CHOICES, term)).resolves.toEqual([0, 2]);
    expect(term.text()).toContain("Check at least one");
  });

  it("cancels on esc, Ctrl+C or end of input", async () => {
    await expect(multiSelect("x", CHOICES, terminal(["\x1b"]))).resolves.toBeUndefined();
    await expect(multiSelect("x", CHOICES, terminal(["\x03"]))).resolves.toBeUndefined();
    const ended = terminal([]);
    ended.input.end();
    await expect(multiSelect("x", CHOICES, ended)).resolves.toBeUndefined();
    const term = terminal(["\x1b"]);
    await multiSelect("Install into:", CHOICES, term);
    expect(term.text()).toContain("✘ Install into: cancelled");
  });

  it("answers [] without reading when every row is disabled", async () => {
    const term = terminal([]);
    await expect(multiSelect("x", [{ label: "Codex", disabled: true }], term)).resolves.toEqual([]);
    expect(term.input.rawModes).toEqual([]);
  });
});

describe("textInput", () => {
  it("edits the initial value and submits it on enter", async () => {
    const term = terminal(["https://x.dev\x7f\x7f\x7fio", "\r"]);
    await expect(textInput("URL", { initial: "" }, term)).resolves.toBe("https://x.io");
    expect(term.text()).toContain("✔ URL https://x.io");
    expect(term.input.rawModes).toEqual([true, false]);
  });

  it("starts from `initial` and clears it with Ctrl+U", async () => {
    await expect(textInput("x", { initial: "old" }, terminal(["\r"]))).resolves.toBe("old");
    await expect(textInput("x", { initial: "old" }, terminal(["\x15new\r"]))).resolves.toBe("new");
  });

  it("ignores arrows and other control keys", async () => {
    await expect(textInput("x", {}, terminal([`a${UP}\tb\r`]))).resolves.toBe("ab");
  });

  it("masks the value while typing and in the summary", async () => {
    const term = terminal(["secret\r"]);
    await expect(textInput("Key", { mask: true }, term)).resolves.toBe("secret");
    expect(term.text()).not.toContain("secret");
    expect(term.text()).toContain("••••••");
    expect(term.text()).toContain("✔ Key ••••••••");
  });

  it("stays open until `validate` accepts, showing why it refused", async () => {
    const term = terminal(["\r", "7\r"]);
    const validate = (value: string) => (value ? undefined : "Required.");
    await expect(textInput("Port", { validate }, term)).resolves.toBe("7");
    expect(term.text()).toContain("Required.");
  });

  it("shows `summary` in place of the value", async () => {
    const term = terminal(["\r"]);
    await textInput("Port", { summary: () => "3768 (default)" }, term);
    expect(term.text()).toContain("✔ Port 3768 (default)");
  });

  it("cancels on esc, Ctrl+C or end of input", async () => {
    await expect(textInput("x", {}, terminal(["ab\x1b"]))).resolves.toBeUndefined();
    await expect(textInput("x", {}, terminal(["\x03"]))).resolves.toBeUndefined();
    const ended = terminal([]);
    ended.input.end();
    await expect(textInput("x", {}, ended)).resolves.toBeUndefined();
    const term = terminal(["\x03"]);
    await textInput("Key", {}, term);
    expect(term.text()).toContain("✘ Key cancelled");
  });
});
