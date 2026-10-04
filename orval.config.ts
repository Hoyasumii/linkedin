import { defineConfig } from "orval";

/**
 * `pnpm codegen`: spec/openapi.yml → src/generated/. Never edit the output by hand.
 * - `endpoints.ts`: one function per operation, sending through `customFetch` (src/transport.ts);
 * - `zod.ts`: the request and response schemas, which the MCP tools reuse as their inputs.
 */
export default defineConfig({
  sdk: {
    input: { target: "./spec/openapi.yml" },
    output: {
      target: "./src/generated/endpoints.ts",
      schemas: "./src/generated/model",
      client: "fetch",
      mode: "single",
      clean: true,
      override: {
        fetch: { includeHttpResponseReturnType: false },
        mutator: { path: "./src/transport.ts", name: "customFetch" },
      },
    },
  },
  zod: {
    input: { target: "./spec/openapi.yml" },
    output: {
      target: "./src/generated/zod.ts",
      client: "zod",
      mode: "single",
    },
  },
});
