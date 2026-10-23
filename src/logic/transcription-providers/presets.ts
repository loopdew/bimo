import type { TranscriptionApiStyle } from './types';

//////////
//////////

/**
 * A known provider, so the user does not have to remember a base URL or guess
 * which vision model to start with.
 *
 * `model` is only a starting suggestion — the "Fetch models" button queries the
 * endpoint's own `/models` route and lets the user pick what they actually have
 * access to. Presets exist to remove typos from the address, not to pin a model.
 */
export interface ProviderPreset {
	id: string;
	label: string;
	baseUrl: string;
	apiStyle: TranscriptionApiStyle;
	/** Suggested starting model. Empty means "you must choose one". */
	model: string;
	/** Shown as a hint under the dropdown. */
	note: string;
}

/**
 * Ordered by how likely a Chinese-language vault is to have a key for it.
 *
 * Every entry speaks the OpenAI Chat Completions wire format — that is the whole
 * reason this list can exist. Azure OpenAI is deliberately absent: it needs a
 * deployment-specific URL and an `api-key` header, which the advanced fields
 * below already cover better than a preset could.
 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
	{
		id: 'deepseek',
		label: 'DeepSeek',
		baseUrl: 'https://api.deepseek.com/v1',
		apiStyle: 'chat-completions',
		model: 'deepseek-flash',
		note: 'deepseek-flash 已支持图片输入（实测可用）。图片会按约 800×800 像素缩放，单图最多计 384 tokens。',
	},
	{
		id: 'siliconflow',
		label: '硅基流动 SiliconFlow',
		baseUrl: 'https://api.siliconflow.cn/v1',
		apiStyle: 'chat-completions',
		model: 'Qwen/Qwen2.5-VL-72B-Instruct',
		note: '模型广场里带 VL / Vision 的都能用，例如 Qwen2.5-VL、GLM-4.1V、deepseek-vl2。',
	},
	{
		id: 'openai',
		label: 'OpenAI',
		baseUrl: 'https://api.openai.com/v1',
		apiStyle: 'chat-completions',
		model: 'gpt-4.1-mini',
		note: '官方只收 PNG / JPEG / WEBP / GIF，SVG 会被 400 拒绝。',
	},
	{
		id: 'gemini',
		label: 'Google Gemini（OpenAI 兼容）',
		baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
		apiStyle: 'chat-completions',
		model: 'gemini-2.5-flash-lite',
		note: '用的是 Google 官方的 OpenAI 兼容层。gemini-2.5-flash-lite 是原版 笔墨 服务端同款，且能关闭思考；Gemini 3 系列识别更强，但官方明确不支持关闭思考，选它请把思考模式改成「低」或「默认」。',
	},
	{
		id: 'moonshot',
		label: 'Moonshot 月之暗面',
		baseUrl: 'https://api.moonshot.cn/v1',
		apiStyle: 'chat-completions',
		model: 'moonshot-v1-8k-vision-preview',
		note: '需要开通带 vision 的模型。',
	},
	{
		id: 'zhipu',
		label: '智谱 GLM',
		baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
		apiStyle: 'chat-completions',
		model: 'glm-4v-flash',
		note: 'glm-4v-flash 有免费额度，适合先试手感。',
	},
	{
		id: 'dashscope',
		label: '通义千问（阿里云百炼）',
		baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
		apiStyle: 'chat-completions',
		model: 'qwen-vl-max',
		note: '走 DashScope 的 OpenAI 兼容模式。',
	},
	{
		id: 'openrouter',
		label: 'OpenRouter',
		baseUrl: 'https://openrouter.ai/api/v1',
		apiStyle: 'chat-completions',
		model: 'google/gemini-2.5-flash',
		note: '一个 key 通吃多家模型，模型名形如 vendor/model。',
	},
	{
		id: 'ollama',
		label: 'Ollama（本机）',
		baseUrl: 'http://localhost:11434/v1',
		apiStyle: 'chat-completions',
		model: 'qwen2.5vl',
		note: '本地推理，不联网、不计费。需先 ollama pull 一个视觉模型。',
	},
	{
		id: 'lmstudio',
		label: 'LM Studio（本机）',
		baseUrl: 'http://localhost:1234/v1',
		apiStyle: 'chat-completions',
		model: '',
		note: '先在 LM Studio 里加载一个视觉模型，再点「获取模型」选它。',
	},
];

export function findProviderPreset(id: string): ProviderPreset | undefined {
	return PROVIDER_PRESETS.find((preset) => preset.id === id);
}
