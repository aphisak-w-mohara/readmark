/**
 * Syntax highlighter: a single-scan tokenizer driven by a small grammar table.
 * Pure — code + language in, highlighted HTML out. No DOM.
 */
import { escapeHtml } from "./escape";

interface Grammar {
  kw: string;
  block: boolean;
  line: string[];
  regex?: RegExp;
  keywords?: Set<string>;
}

const KW_CLIKE =
  "break case catch class const continue default delete do else enum export extends false finally for function if implements import in instanceof interface let new null of package private protected public return static super switch this throw true try typeof undefined var void while with yield async await as from get set namespace type readonly";

const GRAMMARS: Record<string, Grammar> = {
  js: { kw: KW_CLIKE, block: true, line: ["//"] },
  ts: { kw: KW_CLIKE + " number string boolean any unknown never", block: true, line: ["//"] },
  css: { kw: "important media supports keyframes import font-face root", block: true, line: [] },
  json: { kw: "true false null", block: false, line: [] },
  py: {
    kw: "def class return if elif else for while break continue import from as pass lambda with try except finally raise yield global nonlocal in is not and or None True False async await del assert",
    block: false,
    line: ["#"],
  },
  go: {
    kw: "func package import var const type struct interface map chan go defer return if else for range switch case default break continue nil true false string int int64 float64 bool byte rune error",
    block: true,
    line: ["//"],
  },
  rust: {
    kw: "fn let mut const struct enum impl trait pub use mod match if else for while loop return self Self as ref move where dyn async await Some None Ok Err true false",
    block: true,
    line: ["//"],
  },
  java: {
    kw: "public private protected class interface extends implements static final void int long double float boolean char new return if else for while switch case break continue this super import package try catch finally throw throws true false null",
    block: true,
    line: ["//"],
  },
  c: {
    kw: "int char float double void long short unsigned signed struct union enum typedef const static return if else for while switch case break continue sizeof include define NULL true false",
    block: true,
    line: ["//"],
  },
  sh: {
    kw: "if then else elif fi for while do done case esac function return in echo export local read set unset source exit cd",
    block: false,
    line: ["#"],
  },
  sql: {
    kw: "select from where insert update delete into values create table drop alter join left right inner outer on group by order having limit as and or not null distinct union primary key foreign references",
    block: true,
    line: ["--"],
  },
  html: { kw: "", block: false, line: [] },
};

const ALIAS: Record<string, string> = {
  javascript: "js",
  jsx: "js",
  mjs: "js",
  node: "js",
  typescript: "ts",
  tsx: "ts",
  python: "py",
  python3: "py",
  rb: "py",
  ruby: "py",
  yml: "sh",
  yaml: "sh",
  bash: "sh",
  shell: "sh",
  zsh: "sh",
  console: "sh",
  golang: "go",
  rs: "rust",
  cpp: "c",
  "c++": "c",
  h: "c",
  kt: "java",
  kotlin: "java",
  scss: "css",
  less: "css",
  xml: "html",
  vue: "html",
  svelte: "html",
  md: "",
  markdown: "",
  text: "",
  txt: "",
  plain: "",
};

function grammarFor(lang: string): Grammar | null {
  lang = (lang || "").toLowerCase();
  if (lang in ALIAS) lang = ALIAS[lang];
  const g = GRAMMARS[lang];
  if (!g) return null;
  if (!g.regex) {
    const esc = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = [
      g.block ? "(\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->)" : "(\\b\\B)",
      g.line.length ? "((?:" + g.line.map(esc).join("|") + ")[^\\n]*)" : "(\\b\\B)",
      "(\"(?:\\\\.|[^\"\\\\])*\"|'(?:\\\\.|[^'\\\\])*'|`(?:\\\\.|[^`\\\\])*`)",
      "(\\b\\d[\\d_]*(?:\\.[\\d_]+)?(?:[eE][+-]?\\d+)?\\b|0x[0-9a-fA-F]+)",
      "([A-Za-z_$][\\w$]*)",
    ];
    g.regex = new RegExp(parts.join("|"), "g");
    g.keywords = new Set(g.kw.split(/\s+/).filter(Boolean));
  }
  return g;
}

/** Highlight `code` for `lang`. Unknown languages are escaped, unstyled. */
export function highlight(code: string, lang: string): string {
  const g = grammarFor(lang);
  if (!g || !g.regex || !g.keywords) return escapeHtml(code);
  const re = g.regex;
  re.lastIndex = 0;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m.index > last) out += escapeHtml(code.slice(last, m.index));
    const tok = m[0];
    let cls: string | null = null;
    if (m[1] !== undefined || m[2] !== undefined) cls = "com";
    else if (m[3] !== undefined) cls = "str";
    else if (m[4] !== undefined) cls = "num";
    else if (m[5] !== undefined) {
      if (g.keywords.has(tok)) cls = "key";
      else {
        let n = re.lastIndex;
        while (code[n] === " " || code[n] === "\t") n++;
        cls = code[n] === "(" ? "fn" : "name";
      }
    }
    out += cls ? `<span class="t-${cls}">${escapeHtml(tok)}</span>` : escapeHtml(tok);
    last = re.lastIndex;
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  out += escapeHtml(code.slice(last));
  return out;
}
