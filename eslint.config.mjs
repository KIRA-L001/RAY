import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/src-tauri/**",
      "*.config.mjs",
      "**/next-env.d.ts",
    ],
  },
  ...tseslint.configs.recommended,
);
