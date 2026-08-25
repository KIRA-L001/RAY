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
    ],
  },
  ...tseslint.configs.recommended,
);
