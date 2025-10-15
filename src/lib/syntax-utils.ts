/**
 * Get programming language from file extension
 * @param filename - The filename with extension
 * @returns The language identifier for syntax highlighting
 */
export const getLanguageFromFile = (filename: string): string => {
  if (!filename) return "text";

  const ext = filename.split(".").pop()?.toLowerCase();

  const languageMap: Record<string, string> = {
    // JavaScript/TypeScript
    js: "javascript",
    jsx: "jsx",
    ts: "typescript",
    tsx: "tsx",
    mjs: "javascript",
    cjs: "javascript",

    // Python
    py: "python",
    pyw: "python",

    // Web
    html: "html",
    htm: "html",
    css: "css",
    scss: "scss",
    sass: "sass",
    less: "less",

    // Data formats
    json: "json",
    xml: "xml",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",

    // Markup
    md: "markdown",
    markdown: "markdown",

    // Systems programming
    go: "go",
    rs: "rust",
    c: "c",
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    h: "c",
    hpp: "cpp",

    // JVM languages
    java: "java",
    kt: "kotlin",
    scala: "scala",

    // Ruby
    rb: "ruby",

    // PHP
    php: "php",

    // Shell
    sh: "bash",
    bash: "bash",
    zsh: "bash",

    // Other
    sql: "sql",
    graphql: "graphql",
    dockerfile: "docker",

    // Config files
    env: "bash",
    gitignore: "text",

    // Text
    txt: "text",
    log: "text",
  };

  return languageMap[ext || ""] || "text";
};
