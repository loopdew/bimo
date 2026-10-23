// Minimal stand-in for the plugin object.
//
// `vault` used to be an empty object, so any component calling vault.read /
// vault.on blew up with "is not a function". The mock now carries the handful
// of vault methods the embeds and previews actually use.
module.exports = function InkPlugin() {
	return {
		app: {
			vault: {
				read: async () => '',
				cachedRead: async () => '',
				on: () => ({}),
				offref: () => {},
				getResourcePath: () => '',
				getAbstractFileByPath: () => null,
				adapter: {
					exists: async () => false,
					read: async () => '',
				},
			},
			workspace: {
				on: () => () => {},
				off: () => {},
				getLeavesOfType: () => [],
			},
			metadataCache: {
				getFileCache: () => null,
			},
		},
		settings: {},
		manifest: { version: '0.4.0' },
	};
};
