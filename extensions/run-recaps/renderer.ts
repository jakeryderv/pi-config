import {
  getMarkdownTheme,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, Text } from "@earendil-works/pi-tui";

export const RECAP_ENTRY_TYPE = "automatic-run-recap";

export interface RecapData {
  markdown: string;
  provider: string;
  model: string;
  fallback: boolean;
  createdAt: number;
}

export function registerRecapRenderer(pi: ExtensionAPI) {
  pi.registerEntryRenderer<RecapData>(
    RECAP_ENTRY_TYPE,
    (entry, { expanded }, theme) => {
      const data: RecapData = entry.data ?? {
        markdown: "Recap data is unavailable.",
        provider: "unknown",
        model: "unknown",
        fallback: true,
        createdAt: Date.now(),
      };
      const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
      box.addChild(
        new Text(
          `${theme.fg("accent", theme.bold("Run recap"))}${
            data.fallback ? theme.fg("warning", " · local fallback") : ""
          }`,
          0,
          0,
        ),
      );
      box.addChild(new Markdown(data.markdown, 0, 0, getMarkdownTheme()));
      if (expanded) {
        box.addChild(
          new Text(
            theme.fg(
              "dim",
              `${data.provider}/${data.model} · ${new Date(data.createdAt).toLocaleTimeString()}`,
            ),
            0,
            0,
          ),
        );
      }
      return box;
    },
  );
}
