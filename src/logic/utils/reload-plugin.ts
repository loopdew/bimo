import { Notice } from 'obsidian';
import type InkPlugin from 'src/main';
import { t } from 'src/i18n';

//////////
//////////

/**
 * `app.plugins` is not part of the public typings, but it is the only way to
 * cycle a plugin without restarting the app. Guarded at runtime rather than
 * assumed: if a build ever ships without it, the button degrades to a notice
 * instead of throwing.
 */
interface PluginManagerLike {
	disablePlugin?: (id: string) => Promise<void>;
	enablePlugin?: (id: string) => Promise<void>;
}

function getPluginManager(plugin: InkPlugin): PluginManagerLike | null {
	const manager = (plugin.app as unknown as { plugins?: PluginManagerLike }).plugins;
	if (typeof manager?.disablePlugin !== 'function') return null;
	if (typeof manager?.enablePlugin !== 'function') return null;
	return manager;
}

export function canReloadPlugin(plugin: InkPlugin): boolean {
	return getPluginManager(plugin) !== null;
}

/**
 * Unloads and reloads this plugin in place.
 *
 * Disabling first is what makes this a real reload: `enablePlugin` on an
 * already-loaded plugin is a no-op, so a "restart" that skipped the disable step
 * would appear to do nothing while the old code kept running.
 *
 * Anything the user has not saved is their own editor state, not ours — this
 * only cycles the plugin's own registration.
 */
export async function reloadPlugin(plugin: InkPlugin): Promise<void> {
	const manager = getPluginManager(plugin);
	if (!manager) {
		new Notice(t('Could not reload the plugin.'));
		return;
	}

	const id = plugin.manifest.id;
	const name = plugin.manifest.name;
	try {
		await manager.disablePlugin!(id);
		await manager.enablePlugin!(id);
		new Notice(`${name} ${t('reloaded')}`);
	} catch (error) {
		console.debug('笔墨: plugin reload failed', error);
		new Notice(t('Could not reload the plugin.'));
	}
}
