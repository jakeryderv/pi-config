import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CODE_LANGUAGE_ALIASES: Readonly<Record<string, string>> = {
    js: "javascript",
    py: "python",
    sh: "bash",
    shell: "bash",
    ts: "typescript",
    yml: "yaml",
    zsh: "bash",
};

const ASSISTANT_HEADING_COLORS = [
    "\x1b[38;2;255;126;182m",
    "\x1b[38;2;190;149;255m",
    "\x1b[38;2;120;169;255m",
    "\x1b[38;2;51;177;255m",
    "\x1b[38;2;61;219;217m",
    "\x1b[38;2;182;184;187m",
] as const;
const RESET_FOREGROUND = "\x1b[39m";

export function normalizeCodeFenceLanguages(markdown: string) {
    const lines = markdown.split("\n");
    let fence: { marker: "`" | "~"; length: number } | undefined;

    return lines
        .map((line) => {
            const match = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/);
            if (!match?.[2] || match[3] === undefined) return line;
            const marker = match[2][0] as "`" | "~";
            const remainder = match[3];

            if (fence) {
                if (
                    marker === fence.marker &&
                    match[2].length >= fence.length &&
                    remainder.trim() === ""
                ) {
                    fence = undefined;
                }
                return line;
            }

            fence = { marker, length: match[2].length };
            const info = remainder.match(/^([ \t]*)(\S+)(.*)$/);
            if (!info?.[2]) return line;
            const language = CODE_LANGUAGE_ALIASES[info[2].toLowerCase()];
            if (!language) return line;
            return `${match[1]}${match[2]}${info[1]}${language}${info[3]}`;
        })
        .join("\n");
}

export function colorizeAssistantHeadings(markdown: string) {
    const lines = markdown.split("\n");
    let fence: { marker: "`" | "~"; length: number } | undefined;

    return lines
        .map((line) => {
            const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
            if (fenceMatch?.[1]) {
                const marker = fenceMatch[1][0] as "`" | "~";
                if (!fence) {
                    fence = { marker, length: fenceMatch[1].length };
                } else if (
                    marker === fence.marker &&
                    fenceMatch[1].length >= fence.length &&
                    line
                        .slice(
                            line.indexOf(fenceMatch[1]) + fenceMatch[1].length,
                        )
                        .trim() === ""
                ) {
                    fence = undefined;
                }
                return line;
            }
            if (fence) return line;

            const heading = line.match(
                /^( {0,3})(#{1,6})([ \t]+)(.*?)([ \t]+#+[ \t]*)?$/,
            );
            if (!heading?.[2] || heading[4] === undefined) return line;
            const level = heading[2].length;
            const color = ASSISTANT_HEADING_COLORS[level - 1];
            const displayHeading = level >= 3 ? "##" : heading[2];
            return `${heading[1]}${displayHeading}${heading[3]}${color}${heading[4]}${RESET_FOREGROUND}${heading[5] ?? ""}`;
        })
        .join("\n");
}

export function finalizeAssistantMarkdown(
    markdown: string,
    context: { messageType: string; isStreaming: boolean },
) {
    if (context.messageType !== "assistant") return markdown;
    if (context.isStreaming) return "";
    return colorizeAssistantHeadings(normalizeCodeFenceLanguages(markdown));
}

export default function assistantPresentationExtension(pi: ExtensionAPI) {
    pi.registerMarkdownTransformer(finalizeAssistantMarkdown);
}
