import Prism from "prismjs";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-python";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-java";
import "prismjs/components/prism-go";
import type { CodeLanguage } from "./codeDetect";

const PRISM_LANGUAGE: Record<Exclude<CodeLanguage, "plaintext">, string> = {
  javascript: "javascript",
  typescript: "typescript",
  rust: "rust",
  python: "python",
  json: "json",
  html: "markup",
  css: "css",
  shell: "bash",
  yaml: "yaml",
  sql: "sql",
  markdown: "markdown",
  java: "java",
  go: "go",
};

export function prismLanguageClass(language: CodeLanguage): string {
  const map: Record<CodeLanguage, string> = {
    javascript: "language-javascript",
    typescript: "language-typescript",
    rust: "language-rust",
    python: "language-python",
    json: "language-json",
    html: "language-markup",
    css: "language-css",
    shell: "language-bash",
    yaml: "language-yaml",
    sql: "language-sql",
    markdown: "language-markdown",
    java: "language-java",
    go: "language-go",
    plaintext: "language-none",
  };
  return map[language];
}

/** 使用 Prism 高亮代码，语法未知时回退到 JavaScript */
export function highlightCode(content: string, language: CodeLanguage): string {
  if (language === "plaintext") return content;

  const langKey = PRISM_LANGUAGE[language];
  const grammar = Prism.languages[langKey];
  if (!grammar) {
    return Prism.highlight(
      content,
      Prism.languages.javascript!,
      "javascript",
    );
  }
  return Prism.highlight(content, grammar, langKey);
}
