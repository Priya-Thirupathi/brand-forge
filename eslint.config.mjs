import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const restrictedFrameworkImports = [
  { name: "pg", message: "pg is an adapter concern (lib/adapters/postgres)." },
  { name: "@google/genai", message: "@google/genai is an adapter concern (lib/adapters/gemini)." },
  { name: "next", message: "next is a delivery-layer concern (app/)." },
];

// `paths` above only matches the bare specifier ("next"), not a submodule import like
// "next/server" or "next/headers" — those need a glob pattern to be caught too.
const restrictedFrameworkImportPatterns = [
  { group: ["pg/*"], message: "pg is an adapter concern (lib/adapters/postgres)." },
  { group: ["@google/genai/*"], message: "@google/genai is an adapter concern (lib/adapters/gemini)." },
  { group: ["next/*"], message: "next is a delivery-layer concern (app/)." },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // D23: layered code with lint-enforced boundaries (DECISIONS.md). Domain and contracts are
  // pure — no I/O, no framework, no database or SDK imports; services orchestrate against
  // ports and may not reach into adapters or the framework directly either.
  {
    files: ["lib/contracts/**/*.ts", "lib/domain/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...restrictedFrameworkImports, { name: "react", message: "react is a delivery-layer concern (app/, components/)." }],
          patterns: [
            ...restrictedFrameworkImportPatterns,
            { group: ["react/*"], message: "react is a delivery-layer concern (app/, components/)." },
            { group: ["@/lib/adapters/*"], message: "Domain and contracts may not import adapters." },
            { group: ["@/lib/services/*"], message: "Domain and contracts may not import services." },
          ],
        },
      ],
    },
  },
  {
    files: ["lib/services/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: restrictedFrameworkImports,
          patterns: [
            ...restrictedFrameworkImportPatterns,
            { group: ["@/lib/adapters/*"], message: "Services orchestrate against ports, not adapters directly." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
