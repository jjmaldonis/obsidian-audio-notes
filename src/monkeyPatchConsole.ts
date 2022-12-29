import { Platform, Plugin } from 'obsidian';

export const monkeyPatchConsole = (plugin: Plugin) => {
	if (!Platform.isMobile) {
		return;
	}

	const logFile = `${plugin.manifest.dir}/logs.txt`;
	const logs: string[] = [];
	const logMessages = (prefix: string) => (...messages: unknown[]) => {
		logs.push(`\n[${prefix}]`);
		for (const message of messages) {
			logs.push(String(message));
		}
		plugin.app.vault.adapter.write(logFile, logs.join(" "));
	};

	console.debug = logMessages("debug");
	console.error = logMessages("error");
	console.info = logMessages("info");
	console.log = logMessages("log");
	console.warn = logMessages("warn");
};
