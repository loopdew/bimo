import { requestUrl } from 'obsidian';

import { buildHeaders, normalizeProviderBaseUrl } from './openai-compatible';
import type { CustomTranscriptionProviderSettings } from './types';

//////////
//////////

export interface FetchModelsResult {
	models: string[];
	/** Set when the endpoint answered but the payload did not look like a model list. */
	warning?: string;
}

/**
 * Pulls a model ID out of whatever shape the endpoint returned.
 *
 * Covered shapes, all seen in the wild:
 *   - OpenAI / every compatible gateway → `{ data: [{ id }] }`
 *   - Some Chinese gateways            → `{ data: [{ model }] }` or `{ models: [...] }`
 *   - Ollama native /api/tags          → `{ models: [{ name }] }`
 *   - Bare arrays of strings           → `["model-a", "model-b"]`
 */
function extractModelIds(payload: unknown): string[] {
	const ids = new Set<string>();
	if (!payload) return [];

	const pushEntry = (entry: unknown): void => {
		if (typeof entry === 'string') {
			const trimmed = entry.trim();
			if (trimmed) ids.add(trimmed);
			return;
		}
		if (!entry || typeof entry !== 'object') return;
		const item = entry as Record<string, unknown>;
		for (const key of ['id', 'name', 'model', 'slug']) {
			const value = item[key];
			if (typeof value === 'string' && value.trim()) {
				ids.add(value.trim());
				return;
			}
		}
	};

	if (Array.isArray(payload)) {
		payload.forEach(pushEntry);
	} else if (typeof payload === 'object') {
		const record = payload as Record<string, unknown>;
		for (const key of ['data', 'models', 'result', 'items']) {
			const list = record[key];
			if (Array.isArray(list)) list.forEach(pushEntry);
		}
	}

	return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Turns an HTTP failure into something a user can act on. */
function describeHttpFailure(status: number, body: string): string {
	const detail = body.trim().slice(0, 200);
	switch (status) {
		case 401:
		case 403:
			return `密钥被拒绝（HTTP ${status}）。检查 API 密钥是否正确、是否已过期。${detail ? ` 端点返回：${detail}` : ''}`;
		case 404:
			return `端点没有 /models 路由（HTTP 404）。多数情况是 Base URL 少了 /v1，或该网关不实现模型列表——直接把模型名填进输入框即可。${detail ? ` 端点返回：${detail}` : ''}`;
		case 429:
			return `请求过于频繁（HTTP 429）。稍等再试。${detail ? ` 端点返回：${detail}` : ''}`;
		default:
			return `HTTP ${status}${detail ? `：${detail}` : ''}`;
	}
}

/**
 * `GET {baseUrl}/models` with the same auth headers the transcription request
 * uses. Read-only and free on every provider seen so far.
 *
 * Throws an `Error` whose message is user-facing; the caller shows it in a Notice.
 */
export async function fetchAvailableModels(
	settings: CustomTranscriptionProviderSettings,
): Promise<FetchModelsResult> {
	const baseUrl = normalizeProviderBaseUrl(settings.baseUrl);
	const url = `${baseUrl}/models`;

	let response;
	try {
		response = await requestUrl({
			url,
			method: 'GET',
			headers: buildHeaders(settings),
			throw: false,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new Error(`无法连接 ${url} — ${message}`);
	}

	if (response.status < 200 || response.status >= 300) {
		throw new Error(describeHttpFailure(response.status, response.text ?? ''));
	}

	let payload: unknown;
	try {
		payload = response.json;
	} catch {
		throw new Error('端点返回的不是 JSON，可能被登录页或代理拦截了。');
	}

	const models = extractModelIds(payload);
	if (models.length === 0) {
		return {
			models: [],
			warning: '端点有响应，但没解析出任何模型 ID。可能它用的是别的字段结构——直接手填模型名。',
		};
	}

	return { models };
}
