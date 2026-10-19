import type { QuotaModelRegistry } from "./auth.ts";
import { listClaudeSdkOauthAccounts, listQuotaAccounts } from "./auth.ts";
import { formatQuotaResults } from "./format.ts";
import { fetchAnthropicQuota } from "./providers/anthropic.ts";
import { fetchClaudeSdkOauthQuota } from "./providers/claude-sdk-oauth.ts";
import { fetchOpenAiQuota } from "./providers/openai.ts";
import type { AccountFields, ProviderId, ProviderResult, QuotaAccount } from "./types.ts";
import { accountFields } from "./types.ts";

function isAbortError(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError";
}

/**
 * Guards one provider lookup. The adapters are contracted to resolve for every
 * outcome except the caller's own cancellation, so an unexpected throw is
 * downgraded to a failure result rather than being allowed to hide the other
 * provider's answer or crash the command.
 */
function guarded(
	pending: Promise<ProviderResult>,
	provider: ProviderId,
	account: AccountFields,
): Promise<ProviderResult> {
	return pending.catch((error: unknown): ProviderResult => {
		if (isAbortError(error)) throw error;
		return { kind: "failure", provider, reason: { type: "invalid-response" }, ...account };
	});
}

interface QuotaLookupOptions {
	readonly signal: AbortSignal;
	readonly account?: QuotaAccount;
}

/**
 * One lookup per credential account of a provider that pools several, so each
 * account reports its own limits and one account's failure never hides the
 * others. A provider with at most one account keeps the single, unlabelled
 * lookup.
 */
function providerLookups(
	provider: ProviderId,
	accounts: readonly QuotaAccount[],
	fetchQuota: (options: QuotaLookupOptions) => Promise<ProviderResult>,
	signal: AbortSignal,
): readonly Promise<ProviderResult>[] {
	if (accounts.length < 2) {
		return [guarded(fetchQuota({ signal }), provider, {})];
	}
	return accounts.map((account) =>
		guarded(fetchQuota({ signal, account }), provider, accountFields(account)),
	);
}

/**
 * Claude SDK OAuth is an opt-in lane with its own accounts, so a session that
 * never signed into it is not told the lane is missing - the lane is simply not
 * part of the answer.
 */
function claudeSdkOauthLookups(
	registry: QuotaModelRegistry,
	signal: AbortSignal,
): readonly Promise<ProviderResult>[] {
	const accounts = listClaudeSdkOauthAccounts(registry);
	if (accounts.length === 0) return [];
	return providerLookups(
		"claude-sdk-oauth",
		accounts,
		(options) => fetchClaudeSdkOauthQuota(registry, options),
		signal,
	);
}

/** Shared lookup with the extension's provider ordering and plain-text formatting. */
export async function lookupQuota(
	registry: QuotaModelRegistry,
	signal: AbortSignal,
): Promise<{ readonly results: readonly ProviderResult[]; readonly text: string }> {
	const results = await Promise.all([
		...providerLookups(
			"openai-codex",
			listQuotaAccounts(registry, "openai-codex"),
			(options) => fetchOpenAiQuota(registry, options),
			signal,
		),
		...providerLookups(
			"anthropic",
			listQuotaAccounts(registry, "anthropic"),
			(options) => fetchAnthropicQuota(registry, options),
			signal,
		),
		...claudeSdkOauthLookups(registry, signal),
	]);
	return { results, text: formatQuotaResults(results) };
}

export type { QuotaModelRegistry } from "./auth.ts";
export type { ProviderResult } from "./types.ts";
