import { Readable, Writable } from "node:stream";

/** One row of {@link multiSelect}. A disabled row is shown, dimmed, and can never be checked. */
export interface PickerChoice {
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
}

/** The terminal the picker draws on: raw keypresses in, ANSI out. */
export interface PickerTerminal {
  input: Readable & { isRaw?: boolean; setRawMode?(mode: boolean): unknown };
  output: Writable;
}

const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;
const RED = `${ESC}[31m`;
const GREEN = `${ESC}[32m`;
const YELLOW = `${ESC}[33m`;
const CYAN = `${ESC}[36m`;
const INVERSE = `${ESC}[7m`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

const UP = new Set([`${ESC}[A`, "k"]);
const DOWN = new Set([`${ESC}[B`, "j", "\t"]);
const SUBMIT = new Set(["\r", "\n"]);
const CANCEL = new Set([ESC, "\x03"]);

/** A chunk of input as keys: CSI/SS3 escape sequences whole, everything else one character at a time. */
export function splitKeys(data: string): string[] {
  // oxlint-disable-next-line no-control-regex -- terminal keys are escape sequences
  return data.match(/\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/g) ?? [];
}

/**
 * One prompt's hold on the terminal: raw mode on, cursor hidden, every key to `onKey` until
 * `finish` restores the terminal and leaves `summary` in place of what was drawn. End of input
 * finishes with `onEnd`.
 */
function rawSession(
  terminal: PickerTerminal,
  onKey: (key: string) => void,
  onEnd: () => void
): { draw(body: string[]): void; finish(summary: string): void } {
  const { input, output } = terminal;
  const wasRaw = Boolean(input.isRaw);
  let drawn = 0;

  const draw = (body: string[]): void => {
    const clear = drawn > 0 ? `${ESC}[${drawn}A\r${ESC}[0J` : "";
    output.write(`${clear}${body.join("\n")}\n`);
    drawn = body.length;
  };

  const onData = (chunk: Buffer | string): void => {
    for (const key of splitKeys(chunk.toString())) onKey(key);
  };

  const finish = (summary: string): void => {
    input.off("data", onData);
    input.off("end", onEnd);
    input.setRawMode?.(wasRaw);
    input.pause();
    draw([summary]);
    output.write(SHOW_CURSOR);
  };

  input.setRawMode?.(true);
  input.on("data", onData);
  input.once("end", onEnd);
  input.resume();
  output.write(HIDE_CURSOR);
  return { draw, finish };
}

/**
 * A checkbox list: ↑/↓ (or j/k) move, space toggles, `a` toggles all, enter submits, esc or
 * Ctrl+C cancels. Resolves to the checked indexes, or `undefined` when cancelled. Enter with
 * nothing checked does not submit. Leaves one summary line behind.
 */
export function multiSelect(
  message: string,
  choices: readonly PickerChoice[],
  terminal: PickerTerminal
): Promise<number[] | undefined> {
  const enabled = choices.flatMap((choice, index) => (choice.disabled ? [] : [index]));
  if (enabled.length === 0) return Promise.resolve([]);
  const checked = choices.map((choice) => !choice.disabled && Boolean(choice.checked));
  const width = Math.max(...choices.map((choice) => choice.label.length));
  let cursor = enabled[0];
  let warning = "";

  const rows = (): string[] =>
    choices.map((choice, index) => {
      const hint = choice.hint ? `  ${DIM}${choice.hint}${RESET}` : "";
      const label = choice.label.padEnd(width);
      if (choice.disabled) return `    ${DIM}◯ ${label}${RESET}${hint}`;
      const pointer = index === cursor ? `${CYAN}❯${RESET}` : " ";
      const box = checked[index] ? `${GREEN}◉${RESET}` : "◯";
      return `  ${pointer} ${box} ${index === cursor ? `${CYAN}${label}${RESET}` : label}${hint}`;
    });

  const move = (step: number): void => {
    const at = enabled.indexOf(cursor);
    cursor = enabled[(at + step + enabled.length) % enabled.length];
  };

  return new Promise((resolve) => {
    let done = false;
    const end = (result: number[] | undefined): void => {
      done = true;
      session.finish(
        result
          ? `${GREEN}✔${RESET} ${BOLD}${message}${RESET} ${result.map((index) => choices[index].label).join(", ")}`
          : `${RED}✘${RESET} ${BOLD}${message}${RESET} ${DIM}cancelled${RESET}`
      );
      resolve(result);
    };
    const render = (): void =>
      session.draw([
        `${CYAN}?${RESET} ${BOLD}${message}${RESET}`,
        `  ${DIM}↑/↓ move · space toggle · a toggle all · enter submit · esc cancel${RESET}`,
        "",
        ...rows(),
        ...(warning ? ["", `  ${YELLOW}${warning}${RESET}`] : []),
      ]);

    const session = rawSession(
      terminal,
      (key) => {
        if (done) return;
        warning = "";
        if (CANCEL.has(key)) return end(undefined);
        if (SUBMIT.has(key)) {
          const selected = enabled.filter((index) => checked[index]);
          if (selected.length > 0) return end(selected);
          warning = "Check at least one (space), or press esc to cancel.";
        } else if (UP.has(key)) {
          move(-1);
        } else if (DOWN.has(key)) {
          move(1);
        } else if (key === " ") {
          checked[cursor] = !checked[cursor];
        } else if (key === "a") {
          const all = enabled.every((index) => checked[index]);
          for (const index of enabled) checked[index] = !all;
        }
        render();
      },
      () => end(undefined)
    );
    render();
  });
}

/** What {@link textInput} asks. */
export interface TextInputOptions {
  /** Shown dimmed after the message. */
  hint?: string;
  /** The value the line starts with, editable. */
  initial?: string;
  /** Shown dimmed while the line is empty. */
  placeholder?: string;
  /** Echo `•` for each character, and never show the value in the summary. */
  mask?: boolean;
  /** Refuse a submitted value: answers why, or `undefined` to accept it. */
  validate?(value: string): string | undefined;
  /** What the summary line shows for the submitted value. Default: the value, or `•` × 8 when masked. */
  summary?(value: string): string;
}

const BACKSPACE = new Set(["\x7f", "\b"]);
const CLEAR_LINE = "\x15";

/**
 * One line of text: type, backspace deletes, Ctrl+U clears, enter submits (when `validate`
 * accepts), esc or Ctrl+C cancels. Resolves to the line, or `undefined` when cancelled. Leaves
 * one summary line behind.
 */
export function textInput(
  message: string,
  options: TextInputOptions,
  terminal: PickerTerminal
): Promise<string | undefined> {
  let value = Array.from(options.initial ?? "");
  let warning = "";
  const shown = (text: string): string => (options.mask ? "•".repeat(Array.from(text).length) : text);

  return new Promise((resolve) => {
    let done = false;
    const end = (result: string | undefined): void => {
      done = true;
      const summary =
        result === undefined
          ? `${DIM}cancelled${RESET}`
          : options.summary
            ? options.summary(result)
            : options.mask && result
              ? "•".repeat(8)
              : result;
      session.finish(`${result === undefined ? `${RED}✘` : `${GREEN}✔`}${RESET} ${BOLD}${message}${RESET} ${summary}`);
      resolve(result);
    };
    const render = (): void => {
      const text = value.join("");
      const line = text ? shown(text) : options.placeholder ? `${DIM}${options.placeholder}${RESET}` : "";
      session.draw([
        `${CYAN}?${RESET} ${BOLD}${message}${RESET}${options.hint ? `  ${DIM}${options.hint}${RESET}` : ""}`,
        // The terminal cursor is hidden; an inverse space stands in for it.
        `  ${CYAN}›${RESET} ${text ? line : ""}${INVERSE} ${RESET}${text ? "" : line}`,
        ...(warning ? [`  ${YELLOW}${warning}${RESET}`] : []),
      ]);
    };

    const session = rawSession(
      terminal,
      (key) => {
        if (done) return;
        warning = "";
        if (CANCEL.has(key)) return end(undefined);
        if (SUBMIT.has(key)) {
          const text = value.join("");
          const refusal = options.validate?.(text);
          if (refusal === undefined) return end(text);
          warning = refusal;
        } else if (BACKSPACE.has(key)) {
          value = value.slice(0, -1);
        } else if (key === CLEAR_LINE) {
          value = [];
        } else if (key.length === 1 && key >= " ") {
          value.push(key);
        }
        render();
      },
      () => end(undefined)
    );
    render();
  });
}
