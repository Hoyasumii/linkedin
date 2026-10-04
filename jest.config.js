module.exports = {
  preset: "ts-jest",
  setupFiles: ["<rootDir>/tests/setup-env.ts"],
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/?(*.)+(spec|test).ts"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "tsconfig.jest.json", diagnostics: { ignoreCodes: ["TS151001"] } }],
  },
  testTimeout: 60000,
  verbose: true,
  maxWorkers: 1,
};
