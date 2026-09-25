import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["dist/", "output/", "examples/", "**/vendor/", "desktop/out/", "desktop/release/", "desktop/.engine/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: { globals: globals.node },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  // the desktop app's window
  { files: ["desktop/src/renderer/**/*.{ts,tsx}"], languageOptions: { globals: globals.browser } },
  // build scripts run by Node
  { files: ["**/*.mjs"], languageOptions: { globals: globals.node } },
  // tests mock fetch/SDK shapes loosely
  { files: ["**/*.test.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } },
  // browser scripts injected into the HyperFrames composition page
  {
    files: ["src/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, gsap: "readonly", SplitText: "readonly", DrawSVGPlugin: "readonly", MotionPathPlugin: "readonly", THREE: "readonly" } },
  },
);
