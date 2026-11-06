import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["out/**", "app/**", "node_modules/**", "release/**"] },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-unused-vars": "error" },
  },
);
