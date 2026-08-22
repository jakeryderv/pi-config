import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const CUSTOM_ANSWER = "Write my own answer…";

const OptionSchema = Type.Object({
  label: Type.String({ description: "Short display label" }),
  description: Type.Optional(
    Type.String({ description: "Optional explanation shown with the label" }),
  ),
});

const AskUserParams = Type.Object({
  question: Type.String({ description: "The question to ask" }),
  options: Type.Array(OptionSchema, {
    minItems: MIN_OPTIONS,
    maxItems: MAX_OPTIONS,
    description: "Two to five mutually understandable choices",
  }),
});

type AskUserInput = Static<typeof AskUserParams>;

interface AskUserDetails {
  question: string;
  options: string[];
  answer: string | null;
  wasCustom: boolean;
  cancelled: boolean;
}

function optionText(option: AskUserInput["options"][number]) {
  return option.description
    ? `${option.label} — ${option.description}`
    : option.label;
}

export default function askUserExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user one multiple-choice question. Use this when a decision is needed and the choices can be stated clearly.",
    promptSnippet:
      "Ask one focused multiple-choice question when user input is required",
    promptGuidelines: [
      "Use ask_user only when the answer materially changes the next action; do not ask questions that can be resolved from available evidence.",
      "When using ask_user, provide two to five concise, meaningfully distinct choices.",
    ],
    parameters: AskUserParams,
    executionMode: "sequential",

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const labels = params.options.map((option) => option.label);
      const result = (
        text: string,
        answer: string | null,
        wasCustom = false,
      ) => ({
        content: [{ type: "text" as const, text }],
        details: {
          question: params.question,
          options: labels,
          answer,
          wasCustom,
          cancelled: answer === null,
        } satisfies AskUserDetails,
      });

      if (
        params.options.length < MIN_OPTIONS ||
        params.options.length > MAX_OPTIONS
      ) {
        throw new Error(
          `ask_user requires ${MIN_OPTIONS}-${MAX_OPTIONS} options; received ${params.options.length}.`,
        );
      }
      if (labels.some((label) => label.trim().length === 0)) {
        throw new Error("ask_user option labels must not be empty.");
      }
      if (new Set(labels).size !== labels.length) {
        throw new Error("ask_user option labels must be unique.");
      }
      const displayOptions = params.options.map(optionText);
      if (
        new Set(displayOptions).size !== displayOptions.length ||
        displayOptions.includes(CUSTOM_ANSWER)
      ) {
        throw new Error(
          "ask_user options must have unique display text and may not use the custom-answer label.",
        );
      }
      if (ctx.mode !== "tui") {
        return result(
          "The user cannot be prompted outside the interactive TUI.",
          null,
        );
      }
      if (signal?.aborted) return result("The question was cancelled.", null);

      const choices = [...displayOptions, CUSTOM_ANSWER];
      const selected = await ctx.ui.select(params.question, choices, {
        signal,
      });
      if (!selected) return result("The user dismissed the question.", null);

      if (selected === CUSTOM_ANSWER) {
        const custom = await ctx.ui.editor("Your answer", "");
        const answer = custom?.trim();
        if (!answer) return result("The user dismissed the question.", null);
        return result(`User wrote: ${answer}`, answer, true);
      }

      const selectedIndex = choices.indexOf(selected);
      const answer = labels[selectedIndex] ?? selected;
      return result(`User selected ${selectedIndex + 1}: ${answer}`, answer);
    },

    renderCall(args, theme) {
      const question =
        typeof args.question === "string" ? args.question : "Question";
      return new Text(
        `${theme.fg("toolTitle", theme.bold("ask_user "))}${theme.fg("muted", question)}`,
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserDetails | undefined;
      if (!details || details.answer === null) {
        return new Text(theme.fg("warning", "✗ dismissed"), 0, 0);
      }
      const prefix = details.wasCustom ? "✓ wrote: " : "✓ selected: ";
      return new Text(
        theme.fg("success", prefix) + theme.fg("accent", details.answer),
        0,
        0,
      );
    },
  });
}
