export function formatTokens(tokens: number) {
  if (tokens < 1_000) return String(tokens);
  if (tokens < 1_000_000)
    return `${(tokens / 1_000).toFixed(tokens < 10_000 ? 1 : 0)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}m`;
}
