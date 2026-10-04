import type { Credentials } from "../../auth/credentials";
import { daysLeft } from "../../auth/credentials";
import { DEFAULT_API_VERSION } from "../../client";
import type { ConfigKey, ConfigValues } from "../../mcp/config";

/** The pages `linkedin mcp config` serves: plain HTML, styled by the Tailwind browser build. */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const BUTTON =
  "inline-flex w-full cursor-pointer items-center justify-center rounded-md bg-[#0a66c2] px-4 py-2 font-medium text-white " +
  "transition-all duration-200 ease-out hover:bg-[#004182] hover:shadow-md active:scale-[0.98] focus:outline-none " +
  "focus:ring-2 focus:ring-sky-300 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#0a66c2] " +
  "disabled:hover:shadow-none disabled:active:scale-100 dark:bg-[#378fe9] dark:hover:bg-[#5ba4ee] dark:focus:ring-sky-800";
const MUTED = "text-sm text-slate-600 dark:text-slate-400";
const CODE = "rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] dark:bg-slate-800";

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)}</title>
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
</head>
<body class="min-h-screen bg-slate-50 text-slate-900 flex items-center justify-center p-4 dark:bg-slate-950 dark:text-slate-100">
  <main class="w-full max-w-xl rounded-xl bg-white p-8 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
${body}
  </main>
</body>
</html>
`;
}

interface FieldSpec {
  name: ConfigKey;
  label: string;
  type: string;
  value: string;
  placeholder: string;
  help: string;
  /** Rendered with `required`; the page's script keeps the button disabled while it is blank. */
  required?: boolean;
}

function field(spec: FieldSpec): string {
  const marker = spec.required ? ' <span class="text-red-600 dark:text-red-400">*</span>' : "";
  return `      <label class="block">
        <span class="block text-sm font-medium text-slate-700 dark:text-slate-300">${escapeHtml(spec.label)}${marker}</span>
        <input name="${spec.name}" type="${spec.type}" value="${escapeHtml(spec.value)}"
          placeholder="${escapeHtml(spec.placeholder)}" autocomplete="off"${spec.required ? " required" : ""}
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm focus:border-sky-600 focus:outline-none focus:ring-2 focus:ring-sky-200 dark:border-slate-700 dark:bg-slate-800 dark:placeholder-slate-500 dark:focus:ring-sky-900">
        <span class="mt-1 block text-xs text-slate-500 dark:text-slate-400">${escapeHtml(spec.help)}</span>
      </label>`;
}

/** Where the member stands: signed in (as whom, until when), expired, or not yet. */
export function signedInLine(credentials: Credentials | undefined, now = Date.now()): string {
  if (!credentials) return "Not signed in yet.";
  const who = credentials.name ? `${credentials.name} (${credentials.personUrn})` : credentials.personUrn;
  const until = credentials.expiresAt.slice(0, 10);
  return Date.parse(credentials.expiresAt) <= now
    ? `The sign-in as ${who} expired on ${until}.`
    : `Signed in as ${who} until ${until} (${daysLeft(credentials, now)} days).`;
}

export interface FormPageOptions {
  token: string;
  /** What the form shows: the saved values, or what was just submitted. */
  values: ConfigValues;
  /** The saved configuration: a saved secret shows as kept, and a blank field keeps it. */
  saved: ConfigValues;
  configFile: string;
  redirectUri: string;
  credentials?: Credentials;
  error?: string;
}

/**
 * Keeps the button disabled while a required field is blank. The button is rendered enabled, so
 * without scripts the form still posts and the server reports what is missing.
 */
const SUBMIT_GATE = `<script>
      (() => {
        const form = document.getElementById("config");
        const submit = document.getElementById("submit");
        const required = Array.from(form.querySelectorAll("input[required]"));
        const sync = () => { submit.disabled = required.some((input) => input.value.trim() === ""); };
        form.addEventListener("input", sync);
        sync();
        const copy = document.getElementById("copy");
        copy?.addEventListener("click", () => {
          navigator.clipboard?.writeText(copy.dataset.value).then(() => { copy.textContent = "Copied"; });
        });
      })();
    </script>`;

function steps(redirectUri: string): string {
  const link = (href: string, text: string) =>
    `<a class="font-medium text-[#0a66c2] underline-offset-2 hover:underline dark:text-[#5ba4ee]" href="${href}" target="_blank" rel="noreferrer">${text}</a>`;
  return `    <ol class="mb-6 list-decimal space-y-2 pl-5 ${MUTED}">
      <li>${link("https://www.linkedin.com/developers/apps/new", "Create a LinkedIn app")}. LinkedIn asks for a Company Page to attach it to: any page you administer works, even an empty one.</li>
      <li>In its <b>Products</b> tab, add <b>Share on LinkedIn</b> and <b>Sign In with LinkedIn using OpenID Connect</b>.</li>
      <li>In its <b>Auth</b> tab, add this <b>Authorized redirect URL</b>:
        <span class="mt-1 flex items-center gap-2"><code class="${CODE}">${escapeHtml(redirectUri)}</code>
        <button id="copy" type="button" data-value="${escapeHtml(redirectUri)}" class="cursor-pointer rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Copy</button></span></li>
      <li>Copy the <b>Client ID</b> and the <b>Primary Client Secret</b> from the same tab into the fields below.</li>
    </ol>`;
}

export function formPage(options: FormPageOptions): string {
  const { values, saved } = options;
  const error = options.error
    ? `    <p class="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200 dark:bg-red-950/50 dark:text-red-300 dark:ring-red-900">${escapeHtml(options.error)}</p>\n`
    : "";
  return layout(
    "LinkedIn MCP — Sign in",
    `    <h1 class="text-xl font-semibold">LinkedIn MCP</h1>
    <p class="mt-1 ${MUTED}">${escapeHtml(signedInLine(options.credentials))}</p>
    <p class="mt-1 mb-6 text-xs text-slate-500 dark:text-slate-400">Settings saved to <code class="${CODE}">${escapeHtml(options.configFile)}</code></p>
${steps(options.redirectUri)}
${error}    <form id="config" method="post" action="/save" class="space-y-5">
      <input type="hidden" name="t" value="${escapeHtml(options.token)}">
${field({
  name: "LINKEDIN_CLIENT_ID",
  label: "Client ID",
  type: "text",
  value: values.LINKEDIN_CLIENT_ID ?? "",
  placeholder: "86abc123xyz",
  help: "Your LinkedIn app's Client ID.",
  required: true,
})}
${field({
  name: "LINKEDIN_CLIENT_SECRET",
  label: "Client Secret",
  type: "password",
  value: "",
  placeholder: saved.LINKEDIN_CLIENT_SECRET ? "•••••••• (saved — blank keeps it)" : "",
  help: "Your app's Primary Client Secret. Stored only on this computer, readable by you alone.",
  required: !saved.LINKEDIN_CLIENT_SECRET,
})}
      <details class="text-sm">
        <summary class="cursor-pointer text-slate-600 dark:text-slate-400">Advanced</summary>
        <div class="mt-4 space-y-5">
${field({
  name: "LINKEDIN_API_VERSION",
  label: "LinkedIn-Version",
  type: "text",
  value: values.LINKEDIN_API_VERSION ?? "",
  placeholder: DEFAULT_API_VERSION,
  help: `The API version sent (YYYYMM). Blank: ${DEFAULT_API_VERSION}, this release's.`,
})}
        </div>
      </details>
      <button id="submit" type="submit" class="${BUTTON}">Save and sign in with LinkedIn</button>
    </form>
    ${SUBMIT_GATE}`
  );
}

export function signedInPage(credentials: Credentials): string {
  return layout(
    "LinkedIn MCP — Signed in",
    `    <h1 class="text-xl font-semibold text-emerald-700 dark:text-emerald-400">Signed in to LinkedIn</h1>
    <p class="mt-3 ${MUTED}">${escapeHtml(signedInLine(credentials))}</p>
    <p class="mt-3 ${MUTED}">LinkedIn tokens last 60 days; run <code class="${CODE}">linkedin mcp config --web</code> again to renew it.</p>
    <p class="mt-3 ${MUTED}">Not registered in your AI client yet? Run:</p>
    <pre class="mt-2 rounded-md bg-slate-900 px-3 py-2 text-sm text-slate-100 dark:bg-black dark:ring-1 dark:ring-slate-800">linkedin mcp install</pre>
    <p class="mt-6 text-sm text-slate-500 dark:text-slate-400">You can close this tab.</p>`
  );
}

/** A failed sign-in, with a link to start it over. */
export function failedPage(message: string, retryUrl: string): string {
  return layout(
    "LinkedIn MCP — Sign-in failed",
    `    <h1 class="text-xl font-semibold text-red-700 dark:text-red-400">Sign-in failed</h1>
    <p class="mt-3 ${MUTED}">${escapeHtml(message)}</p>
    <a href="${escapeHtml(retryUrl)}" class="mt-6 ${BUTTON}">Back to the settings</a>`
  );
}

export function messagePage(title: string, message: string): string {
  return layout(
    title,
    `    <h1 class="text-xl font-semibold">${escapeHtml(title)}</h1>
    <p class="mt-3 ${MUTED}">${escapeHtml(message)}</p>`
  );
}
