import { ConfigKey, ConfigValues } from "../../mcp/config";
import { configValueError } from "./config-ui";
import { PickerTerminal, TextInputOptions, textInput } from "./picker";

/**
 * Ask for the app's Client ID and Client Secret, starting from the saved values, with the form's
 * rules: a blank secret keeps the saved one. Answers what was entered, for `valuesFromInput`, or
 * `undefined` when a prompt was cancelled.
 */
export async function promptConfig(saved: ConfigValues, terminal: PickerTerminal): Promise<ConfigValues | undefined> {
  const input: ConfigValues = { ...saved, LINKEDIN_CLIENT_SECRET: undefined };
  const ask = async (key: ConfigKey, label: string, options: TextInputOptions): Promise<boolean> => {
    const value = await textInput(label, options, terminal);
    if (value === undefined) return false;
    input[key] = value;
    return true;
  };

  const clientId: TextInputOptions = {
    hint: "your LinkedIn app's Client ID (Auth tab)",
    initial: saved.LINKEDIN_CLIENT_ID,
    validate: (value) =>
      value.trim() ? configValueError("LINKEDIN_CLIENT_ID", value.trim()) : "The Client ID is required.",
  };
  if (!(await ask("LINKEDIN_CLIENT_ID", "Client ID", clientId))) return undefined;
  const clientSecret: TextInputOptions = {
    mask: true,
    hint: saved.LINKEDIN_CLIENT_SECRET ? "saved · enter keeps it" : "the app's Primary Client Secret (Auth tab)",
    validate: (value) => (value.trim() || saved.LINKEDIN_CLIENT_SECRET ? undefined : "The Client Secret is required."),
    summary: (value) => (value.trim() ? "••••••••" : "kept"),
  };
  if (!(await ask("LINKEDIN_CLIENT_SECRET", "Client Secret", clientSecret))) return undefined;
  return input;
}
