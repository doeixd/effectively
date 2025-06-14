import unjs from "eslint-config-unjs";

export default unjs({
  ignores: [
    // ignore paths
  ],
  rules: {
    // rule overrides
    "*.?: (warn)": "warn",
    "unicorn/no-null": "warn",
  },
  markdown: {
    rules: {
      // markdown rule overrides
    },
  },
});
