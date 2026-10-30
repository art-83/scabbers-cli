export function redactLog(value: string): string {
  return value
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(
      /-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END (?:[A-Z ]*PRIVATE KEY)-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:xox[baprs]-[\w-]+|glpat-[\w-]+|AKIA[A-Z0-9]{16}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]+|eyJ[\w-]+\.[\w-]+\.[\w-]+)\b/g,
      "[REDACTED]",
    )
    .replace(
      /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=.-]+/gi,
      "[REDACTED AUTHORIZATION]",
    )
    .replace(
      /\b((?:[\w-]*(?:password|passwd|senha|secret|token|api[_-]?key|access[_-]?key)[\w-]*)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@");
}

export class LogRedactor {
  private readonly privateKeyStreams = new Set<string>();
  redact(value: string, stream: string): string {
    let text = value;
    const end = /-----END [A-Z ]*PRIVATE KEY-----/;
    if (this.privateKeyStreams.has(stream)) {
      const match = end.exec(text);
      if (!match) return "[REDACTED PRIVATE KEY CONTINUATION]";
      this.privateKeyStreams.delete(stream);
      text =
        "[REDACTED PRIVATE KEY]" + text.slice(match.index + match[0].length);
    }
    const begin = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.exec(text);
    if (begin && !end.test(text.slice(begin.index))) {
      this.privateKeyStreams.add(stream);
      text = text.slice(0, begin.index) + "[REDACTED PRIVATE KEY]";
    }
    return redactLog(text);
  }
}
