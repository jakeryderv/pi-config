import assert from "node:assert/strict";
import test from "node:test";
import { textFromMessageContent } from "./index.ts";

test("textFromMessageContent keeps text and image placeholders", () => {
  assert.equal(
    textFromMessageContent([
      { type: "text", text: "hello" },
      { type: "toolCall", name: "read" },
      { type: "image" },
    ]),
    "hello\n[image]",
  );
});
