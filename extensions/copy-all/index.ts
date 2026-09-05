import {
  copyToClipboard,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { registerCopyAllCommand } from "./command.ts";

export default function copyAllExtension(pi: ExtensionAPI) {
  registerCopyAllCommand(pi, copyToClipboard);
}
