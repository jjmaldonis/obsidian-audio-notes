import AutomaticAudioNotes from "./main";
import { PluginSettingTab, Setting, Notice, ToggleComponent, request, App } from "obsidian";
import { secondsToTimeString } from "./utils";

export class AudioNotesSettingsTab extends PluginSettingTab {
	plugin: AutomaticAudioNotes;

	constructor(app: App, plugin: AutomaticAudioNotes) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		let { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("+/- duration (seconds) when generating new nodes")
			.setDesc("The amount of time add to and subtract from the current time when creating new audio notes")
			.addText((text) =>
				text
					.setPlaceholder("30")
					.setValue(this.plugin.settings.plusMinusDuration)
					.onChange(async (value) => {
						try {
							parseFloat(value);
							this.plugin.settings.plusMinusDuration = value;
							await this.plugin.saveSettings();
						} catch {
							new Notice("Must be a number");
						}
					})
			);

		new Setting(containerEl)
			.setName("Skip backward (seconds)")
			.setDesc("The amount of time to skip backward when pressing the backward button on the audio player")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(this.plugin.settings.forwardStep)
					.onChange(async (value) => {
						try {
							parseFloat(value);
							this.plugin.settings.forwardStep = value;
							await this.plugin.saveSettings();
						} catch {
							new Notice("Must be a number");
						}
					})
			);

		new Setting(containerEl)
			.setName("Skip forward (seconds)")
			.setDesc("The amount of time to skip forward when pressing the forward button on the audio player")
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(this.plugin.settings.backwardStep)
					.onChange(async (value) => {
						try {
							parseFloat(value);
							this.plugin.settings.backwardStep = value;
							await this.plugin.saveSettings();
						} catch {
							new Notice("Must be a number");
						}
					})
			);

		new Setting(containerEl)
			.setName('Audio Notes API Key')
			.setDesc('Provided by the library maintainer for paying users.Used to work with transcripts online.')
			.addText((text) =>
				text
					.setPlaceholder('<your api key>')
					.setValue(this.plugin.settings.audioNotesApiKey)
					.onChange(async (value) => {
						this.plugin.settings.audioNotesApiKey = value;
						await this.plugin.saveSettings();
					}));

		new Setting(containerEl)
			.setName('Debugging mode')
			.setDesc('Turn on to log console messages to log.txt in the plugin folder (requires restart).')
			.addToggle((toggle: ToggleComponent) => {
				toggle.onChange(async (value: boolean) => {
					this.plugin.settings.debugMode = value;
					await this.plugin.saveSettings();
				});
			});

		containerEl.createEl("hr");
		containerEl.createDiv("p").textContent = `MP3 files added for transcription:`;
		request({
			url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/users/files',
			method: 'GET',
			headers: {
				'x-api-key': this.plugin.getSettingsAudioNotesApiKey(),
			},
			contentType: 'application/json',
		}).then((result: string) => {
			const urls: [string, string][] = JSON.parse(result);
			if (urls.length > 0) {
				const table = containerEl.createEl("table");
				const tr = table.createEl("tr")
				tr.createEl("th").textContent = "Status";
				tr.createEl("th").textContent = "Length";
				tr.createEl("th").textContent = "URL";
				for (let i = 0; i < urls.length; i++) {
					const [url, status] = urls[i];
					const tr = table.createEl("tr")
					tr.createEl("td").textContent = status;
					const lengthTd = tr.createEl("td");
					lengthTd.textContent = "???";
					tr.createEl("td").textContent = url;

					request({
						url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/transcriptions',
						method: 'GET',
						headers: {
							'x-api-key': this.plugin.getSettingsAudioNotesApiKey(),
							"url": url,
						},
						contentType: 'application/json',
					}).then((result: string) => {
						const transcript = JSON.parse(result);
						const lastSegment = transcript.segments[transcript.segments.length - 1];
						lengthTd.textContent = secondsToTimeString(lastSegment.end, true);
					});

				}
			}
		});
	}
}

export interface AudioNotesSettings {
	plusMinusDuration: string;
	backwardStep: string;
	forwardStep: string;
	audioNotesApiKey: string;
	debugMode: boolean;
}

export const DEFAULT_SETTINGS: Partial<AudioNotesSettings> = {
	plusMinusDuration: "30",
	backwardStep: "5",
	forwardStep: "15",
	audioNotesApiKey: "",
	debugMode: false,
};
