import type { ExtensionAPI, ExtensionCommandContext } from "@code-yeongyu/senpi";
import { notifySeverityForResults, whiteText } from "./format.ts";
import { lookupQuota } from "./lookup.ts";

const STATUS_KEY = "pi-quota";
const LOADING_STATUS = "Loading quota...";
const USAGE_MESSAGE = "/quota takes no arguments. Run /quota on its own to read your quota.";
const SCOPE_MESSAGE = "/quota is available in interactive mode only. No quota request was made.";
const COMMAND_DESCRIPTION = "Show OpenAI Codex, Anthropic and Claude SDK subscription quota";

export default function (pi: ExtensionAPI): void {
	let currentController: AbortController | undefined;

	pi.registerCommand("quota", {
		description: COMMAND_DESCRIPTION,
		handler: async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
			if (args.trim().length > 0) {
				ctx.ui.notify(USAGE_MESSAGE, "info");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify(SCOPE_MESSAGE, "info");
				return;
			}
			currentController?.abort();
			const controller = new AbortController();
			currentController = controller;
			ctx.ui.setStatus(STATUS_KEY, LOADING_STATUS);
			try {
				const { results, text } = await lookupQuota(ctx.modelRegistry, controller.signal);
				if (currentController !== controller) return;
				if (text !== "") {
					ctx.ui.notify(whiteText(text), notifySeverityForResults(results));
				}
			} catch {
				// A newer invocation or session shutdown owns the UI after cancellation.
			} finally {
				if (currentController === controller) {
					ctx.ui.setStatus(STATUS_KEY, undefined);
					currentController = undefined;
				}
			}
		},
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		currentController?.abort();
		currentController = undefined;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});
}
