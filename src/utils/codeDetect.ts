export type CodeLanguage =
  | "javascript"
  | "typescript"
  | "rust"
  | "python"
  | "json"
  | "html"
  | "css"
  | "shell"
  | "yaml"
  | "sql"
  | "markdown"
  | "java"
  | "go"
  | "plaintext";

export interface CodeDetectionResult {
  isCode: boolean;
  language: CodeLanguage;
}

const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g;

const CODE_KEYWORD_REGEX =
  /\b(function|const|let|var|return|import|export|class|interface|enum|def|elif|lambda|async|await|fn|pub|struct|impl|use|match|package|func|SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|CREATE|ALTER|DROP|echo|sudo|git|npm|cargo|println!|console\.log)\b/i;

type ScoredLanguage = Exclude<CodeLanguage, "plaintext">;

interface LanguageScore {
  language: ScoredLanguage;
  score: number;
}

/** 统计 CJK 字符占比（忽略空白） */
function cjkRatio(text: string): number {
  const significant = text.replace(/\s/g, "");
  if (!significant) return 0;
  const matches = significant.match(CJK_REGEX);
  return (matches?.length ?? 0) / significant.length;
}

/** 是否更像中文自然段落，而非代码 */
function looksLikeChineseProse(text: string): boolean {
  const ratio = cjkRatio(text);
  if (ratio < 0.2) return false;

  const lines = text.split("\n").filter((line) => line.trim());
  const chinesePunctuation =
    /[。！？；，、：""''（）【】《》…—]/.test(text);
  const proseLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!CJK_REGEX.test(trimmed)) return false;
    return !/[{}();=<>[\]]/.test(trimmed);
  }).length;

  const hasCodeKeyword = CODE_KEYWORD_REGEX.test(text);
  const hasShebang = /^#!/.test(text.trim());

  if (hasShebang || hasCodeKeyword) return false;

  return ratio >= 0.35 && chinesePunctuation && proseLines >= 1;
}

function scoreJson(text: string): number {
  const trimmed = text.trim();
  if (
    !(trimmed.startsWith("{") && trimmed.endsWith("}")) &&
    !(trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    return 0;
  }
  try {
    JSON.parse(trimmed);
    return 12;
  } catch {
    return 0;
  }
}

function scoreHtml(text: string): number {
  let score = 0;
  if (/<!DOCTYPE\s+html/i.test(text)) score += 8;
  if (/<html[\s>]/i.test(text)) score += 6;
  if (/<(head|body|script|style|div|span|svg|meta)\b/i.test(text)) score += 4;
  if (/<\/\w+>/.test(text)) score += 2;
  return score;
}

function scoreCss(text: string): number {
  if (!/[.#\w-]+\s*\{[^}]*\}/m.test(text)) return 0;
  if (!/:\s*[^;]+;/.test(text)) return 0;
  if (/@(media|keyframes|import)\b/.test(text)) return 8;
  return 6;
}

function scoreShell(text: string): number {
  let score = 0;
  if (/^#!\/\S+/m.test(text)) score += 10;
  if (/^\$\s|\becho\b|\bexport\b|\bsudo\b|\bgit\s+\w+/.test(text)) score += 3;
  if (/\|\s*\w+/.test(text) && /\b(grep|awk|sed|curl|wget)\b/.test(text)) score += 2;
  return score;
}

function scoreRust(text: string): number {
  let score = 0;
  if (/\bfn\s+\w+\s*\(/.test(text)) score += 5;
  if (/\b(pub\s+)?fn\b/.test(text)) score += 2;
  if (/\buse\s+\w+::/.test(text)) score += 4;
  if (/\bimpl\s+/.test(text)) score += 4;
  if (/\bmatch\s+\w+\s*\{/.test(text)) score += 3;
  if (/\bprintln!\s*\(/.test(text)) score += 3;
  return score;
}

function scorePython(text: string): number {
  let score = 0;
  if (/^\s*(def|class)\s+\w+/m.test(text)) score += 5;
  if (/^\s*(import|from)\s+\w+/m.test(text)) score += 4;
  if (/\belif\b|\bpass\b|\bself\b/.test(text)) score += 2;
  if (/:\s*$/m.test(text)) score += 1;
  return score;
}

function scoreTypeScript(text: string): number {
  let score = 0;
  if (/\binterface\s+\w+/.test(text)) score += 6;
  if (/\btype\s+\w+\s*=/.test(text)) score += 5;
  if (/:\s*(string|number|boolean|void|never|unknown)\s*[;,)}\]]/.test(text)) {
    score += 3;
  }
  if (/\b(readonly|as const|keyof|typeof|satisfies)\b/.test(text)) score += 3;
  if (/<[A-Z]\w*>/.test(text)) score += 1;
  return score;
}

function scoreJavaScript(text: string): number {
  let score = 0;
  if (/\b(const|let|var|function|class|import|export)\b/.test(text)) score += 4;
  if (/=>/.test(text)) score += 2;
  if (/\bconsole\.(log|error|warn)\s*\(/.test(text)) score += 2;
  return score;
}

function scoreGo(text: string): number {
  let score = 0;
  if (/^package\s+\w+/m.test(text)) score += 6;
  if (/\bfunc\s+\w+/.test(text)) score += 4;
  if (/\b:=/.test(text)) score += 2;
  if (/\bfmt\.Print/.test(text)) score += 2;
  return score;
}

function scoreJava(text: string): number {
  let score = 0;
  if (/\bpublic\s+class\s+\w+/.test(text)) score += 6;
  if (/\bpublic\s+static\s+void\s+main\s*\(/.test(text)) score += 5;
  if (/\bSystem\.out\.println\s*\(/.test(text)) score += 3;
  if (/@Override\b/.test(text)) score += 2;
  return score;
}

function scoreSql(text: string): number {
  let score = 0;
  if (/\bSELECT\b[\s\S]+\bFROM\b/i.test(text)) score += 6;
  if (/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE)\b/i.test(text)) {
    score += 5;
  }
  if (/\b(WHERE|JOIN|GROUP\s+BY|ORDER\s+BY)\b/i.test(text)) score += 2;
  return score;
}

function scoreYaml(text: string): number {
  if (text.trim().startsWith("---")) return 7;
  const lines = text.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
  if (lines.length < 2) return 0;
  const kvLines = lines.filter((line) => /^[\w.-]+:\s*.+/.test(line.trim())).length;
  if (kvLines >= 2 && kvLines / lines.length >= 0.6) return 6;
  return 0;
}

function scoreMarkdown(text: string): number {
  let score = 0;
  if (/^#{1,6}\s+\S/m.test(text)) score += 4;
  if (/^[-*+]\s+\S/m.test(text)) score += 2;
  if (/\[.+?\]\(.+?\)/.test(text)) score += 2;
  if (/^```[\w-]*$/m.test(text)) score += 4;
  if (/^>\s+\S/m.test(text)) score += 1;
  return score;
}

function scoreGenericCode(text: string): number {
  const lines = text.split("\n");
  if (lines.length < 2) return 0;
  let score = 0;
  if (/\{[\s\S]*\}/.test(text) && /;/.test(text)) score += 2;
  if (/^\s{2,4}\S/m.test(text)) score += 1;
  if (/\/\/|\/\*|#(?!!)/.test(text)) score += 1;
  return score;
}

const SCORERS: Record<ScoredLanguage, (text: string) => number> = {
  json: scoreJson,
  html: scoreHtml,
  css: scoreCss,
  shell: scoreShell,
  rust: scoreRust,
  python: scorePython,
  typescript: scoreTypeScript,
  javascript: scoreJavaScript,
  go: scoreGo,
  java: scoreJava,
  sql: scoreSql,
  yaml: scoreYaml,
  markdown: scoreMarkdown,
};

const MIN_CODE_SCORE = 4;
const STRONG_CODE_SCORE = 7;

/**
 * 启发式检测剪贴板文本是否为代码，并推断语言类型。
 * 对中文自然文本做专门排除，避免误判为代码。
 */
export function detectCode(content: string): CodeDetectionResult {
  const trimmed = content.trim();
  if (!trimmed) {
    return { isCode: false, language: "plaintext" };
  }

  const scores: LanguageScore[] = (
    Object.entries(SCORERS) as [ScoredLanguage, (text: string) => number][]
  )
    .map(([language, scorer]) => ({ language, score: scorer(trimmed) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  const best = scores[0];
  const genericScore = scoreGenericCode(trimmed);
  const effectiveScore = best ? best.score + genericScore * 0.25 : genericScore;
  const ratio = cjkRatio(trimmed);

  if (!best || effectiveScore < MIN_CODE_SCORE) {
    return { isCode: false, language: "plaintext" };
  }

  if (looksLikeChineseProse(trimmed) && effectiveScore < STRONG_CODE_SCORE) {
    return { isCode: false, language: "plaintext" };
  }

  if (ratio > 0.55 && effectiveScore < STRONG_CODE_SCORE) {
    return { isCode: false, language: "plaintext" };
  }

  if (best.language === "javascript" && scoreTypeScript(trimmed) > best.score) {
    return { isCode: true, language: "typescript" };
  }

  if (
    best.language === "markdown" &&
    scores.some((item) => item.language !== "markdown" && item.score >= MIN_CODE_SCORE)
  ) {
    const codeLike = scores.find((item) => item.language !== "markdown");
    if (codeLike) {
      return { isCode: true, language: codeLike.language };
    }
  }

  return { isCode: true, language: best.language };
}
