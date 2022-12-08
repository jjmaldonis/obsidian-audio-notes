import {
	MarkdownView,
	Plugin,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownRenderChild,
	Notice,
	TFile,
	Platform,
	PluginSettingTab,
	App,
	Setting,
} from 'obsidian';
import { IconPrefix } from "@fortawesome/free-regular-svg-icons";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import {
	findIconDefinition,
	icon as getFAIcon,
} from "@fortawesome/fontawesome-svg-core";


class DefaultMap<K, V> extends Map<K, V> {
	/** Usage
	 * new DefaultMap<string, Number>(() => 0)
	 * new DefaultMap<string, Array>(() => [])
	 */
	constructor(private defaultFactory: () => V) {
		super();
	}

	get(key: K): V {
		if (!super.has(key)) {
			super.set(key, this.defaultFactory());
		}
		return super.get(key)!;
	}
}


function generateRandomString(length: number) {
	let result = '';
	const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	const charactersLength = characters.length;
	for (var i = 0; i < length; i++) {
		result += characters.charAt(Math.floor(Math.random() * charactersLength));
	}
	return result;
}


function getIcon(iconName: string) {
	for (const prefix of ["fas", "far", "fab", "fa"] as IconPrefix[]) {
		const definition = findIconDefinition({
			iconName: iconName as IconName,
			prefix
		});
		if (definition) return getFAIcon(definition).node[0];
	}
}


function secondsToTimeString(totalSeconds: number, truncateMilliseconds: boolean): string {
	if (totalSeconds === 0) {
		return "00:00";
	}
	let hours = Math.floor(totalSeconds / 3600);
	let minutes = Math.floor((totalSeconds / 60 - (hours * 60)));
	let seconds = totalSeconds - (hours * 3600 + minutes * 60);
	let s = "";
	if (hours > 0) {
		if (hours >= 10) {
			s += hours.toString() + ":";
		} else {
			s += "0" + hours.toString() + ":";
		}
	}
	if (minutes >= 10) {
		s += minutes.toString() + ":";
	} else {
		s += "0" + minutes.toString() + ":";
	}
	seconds = Math.round(seconds * 100) / 100; // round to 2 decimal places
	if (seconds >= 10) {
		s += seconds.toString();
	} else {
		s += "0" + seconds.toString();
	}
	if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds) || hours === undefined || minutes === undefined || seconds === undefined) {
		throw new Error(`Failed to convert seconds to time string: ${totalSeconds}`);
	}
	if (truncateMilliseconds && s.includes(".")) {
		s = s.slice(0, s.indexOf("."));
	}
	return s;
}


function timeStringToSeconds(s: string): number {
	let hours = 0;
	let minutes = 0;
	let seconds = 0;
	const split = s.split(":");
	if (split.length > 2) {
		hours = parseInt(split[0]);
		minutes = parseInt(split[1]);
		seconds = parseFloat(split[2]);
	} else if (split.length > 1) {
		minutes = parseInt(split[0]);
		seconds = parseFloat(split[1]);
	} else {
		seconds = parseFloat(split[0]);
	}
	if (Number.isNaN(hours) || Number.isNaN(minutes) || Number.isNaN(seconds) || hours === undefined || minutes === undefined || seconds === undefined) {
		throw new Error(`Failed to convert time string to seconds: ${s}`);
	}
	return (hours * 3600) + (minutes * 60) + seconds;
}


class AudioBlock {
	constructor(
		public audioFilename: string,
		private _start: number,
		private _end: number,
	) { }

	get start(): number {
		return this._start;
	}

	get end(): number {
		return this._end;
	}

	set start(value: number) {
		if (value < 0) {
			value = 0;
		}
		this._start = value;
	}

	set end(value: number) {
		// There is no way to check the duration of the audio file unfortunately.
		this._end = value;
	}
}

class AudioBlockWithCurrentTime extends AudioBlock {
	constructor(
		audioFilename: string,
		start: number,
		end: number,
		public currentTime: number,
	) {
		super(audioFilename, start, end);
	}
}

class AudioNote extends AudioBlock {
	constructor(
		public title: string | undefined,
		public author: string | undefined,
		public audioFilename: string,
		_start: number, // defaults to 0
		_end: number, // defaults to Infinity
		public transcriptFilename: string | undefined,
		public quoteCreatedForStart: number | undefined,
		public quoteCreatedForEnd: number | undefined,
		public quote: string | undefined,
		public extendAudio: boolean,
	) {
		super(audioFilename, _start, _end);
	}

	get needsToBeUpdated(): boolean {
		if (!this.quote) {
			return true;
		} else {
			return false;
		}
		if (this.start !== this.quoteCreatedForStart || this.end !== this.quoteCreatedForEnd) {
			return true;
		} else {
			return false;
		}
	}

	getFormattedTitle(): string {
		let viewableStartTime = undefined;
		let viewableEndTime = undefined;

		if (this.end !== Infinity) {
			viewableStartTime = secondsToTimeString(Math.floor(this.start), false);
			if (viewableStartTime.startsWith("0")) {
				viewableStartTime = viewableStartTime.slice(1, undefined);
			}

			viewableEndTime = secondsToTimeString(Math.floor(this.end), false);
			if (viewableEndTime.startsWith("0")) {
				viewableEndTime = viewableEndTime.slice(1, undefined);
			}
		} else {
			if (this.start !== 0) {
				viewableStartTime = secondsToTimeString(Math.floor(this.start), false);
				if (viewableStartTime.startsWith("0")) {
					viewableStartTime = viewableStartTime.slice(1, undefined);
				}
				viewableEndTime = "...";
			}
		}

		let titleStr = "";
		if (this.title) {
			titleStr = this.title;
		}
		let result;
		if (viewableStartTime === undefined) {
			result = `&nbsp&nbsp${titleStr}`;
		} else {
			result = `&nbsp&nbsp${titleStr}: ${viewableStartTime} - ${viewableEndTime}`;
		}
		return result;
	}
}

class AudioNoteWithPositionInfo extends AudioNote {
	constructor(
		public title: string | undefined,
		public author: string | undefined,
		public audioFilename: string,
		_start: number,
		_end: number,
		public transcriptFilename: string | undefined,
		public quoteCreatedForStart: number | undefined,
		public quoteCreatedForEnd: number | undefined,
		public quote: string | undefined,
		public extendAudio: boolean,
		public startLineNumber: number,
		public endLineNumber: number,
		public endChNumber: number,
	) { super(title, author, audioFilename, _start, _end, transcriptFilename, quoteCreatedForStart, quoteCreatedForEnd, quote, extendAudio); }

	static fromAudioNote(audioNote: AudioNote, startLineNumber: number, endLineNumber: number, endChNumber: number): AudioNoteWithPositionInfo {
		return new AudioNoteWithPositionInfo(
			audioNote.title,
			audioNote.author,
			audioNote.audioFilename,
			audioNote.start,
			audioNote.end,
			audioNote.transcriptFilename,
			audioNote.quoteCreatedForStart,
			audioNote.quoteCreatedForEnd,
			audioNote.quote,
			audioNote.extendAudio,
			startLineNumber,
			endLineNumber,
			endChNumber,
		)
	}
}


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
			.setName("Skip forward/backward (seconds)")
			.setDesc("The amount of time to fast forward or rewind when pressing the forward/backward buttons on the audio player")
			.addText((text) =>
				text
					.setPlaceholder("5")
					.setValue(this.plugin.settings.forwardBackwardStep)
					.onChange(async (value) => {
						try {
							parseFloat(value);
							this.plugin.settings.forwardBackwardStep = value;
							await this.plugin.saveSettings();
						} catch {
							new Notice("Must be a number");
						}
					})
			);
	}
}

interface AudioNotesSettings {
	plusMinusDuration: string;
	forwardBackwardStep: string;
}

const DEFAULT_SETTINGS: Partial<AudioNotesSettings> = {
	plusMinusDuration: "30",
	forwardBackwardStep: "5",
};

export default class AutomaticAudioNotes extends Plugin {
	settings: AudioNotesSettings;
	knownCurrentTimes: Map<string, number> = new Map();
	knownAudioPlayers: DefaultMap<string, HTMLElement[]> = new DefaultMap(() => []);
	currentlyPlayingAudioFakeUuid: string | null = null;

	private get isDesktop(): boolean {
		return Platform.isDesktop || Platform.isDesktopApp || Platform.isMacOS;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	getSettingsDynamically(): AudioNotesSettings {
		return this.settings;
	}

	getSettingsPlusMinusDuration(): number {
		return parseFloat(this.settings.plusMinusDuration);
	}

	getSettingsForwardBackwardStep(): number {
		return parseFloat(this.settings.forwardBackwardStep);
	}

	updateCurrentTimeOfAudio(audio: HTMLMediaElement): void {
		// There is a minor bug if users delete a src and readd the same src, because the currentTime will change on the new src.
		this.knownCurrentTimes.set(audio.src, audio.currentTime);
		const knownAudios = this.knownAudioPlayers.get(audio.src);
		for (const knownPlayer of knownAudios) {
			const knownAudio = (knownPlayer.find("audio")! as HTMLMediaElement);
			const knownPlayerFakeUuid = knownPlayer.id.split("-")[knownPlayer.id.split("-").length - 1];
			// Do not update the same player that is currently changing.
			if (audio.currentTime !== knownAudio.currentTime && this.currentlyPlayingAudioFakeUuid !== knownPlayerFakeUuid) {
				knownAudio.currentTime = audio.currentTime;
				const timeSpan = knownPlayer.querySelector(".time")!;
				timeSpan.textContent = secondsToTimeString(audio.currentTime, true) + " / " + secondsToTimeString(audio.duration, true);
				const seeker = (knownPlayer.querySelector(".seek-slider")! as any);
				seeker.value = audio.currentTime.toString();
			}
		}
	}

	async onload() {
		// Settings
		await this.loadSettings();
		this.addSettingTab(new AudioNotesSettingsTab(this.app, this));

		this.addCommand({
			id: 'create-new-audio-note',
			name: `Create new Audio Note at current time (+/- ${this.getSettingsPlusMinusDuration()} seconds)`,
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						// Note: `.catch` is required (rather than `await ...`) due to the type required by `editorCheckCallback`.
						this.getFirstAudioNoteInFile(markdownView.file).then((audioNote: AudioNote) => {
							const audioSrcPath = this._getFullAudioSrcPath(audioNote);
							if (!audioSrcPath) {
								return undefined;
							}
							let currentTime = this.knownCurrentTimes.get(audioSrcPath);
							if (!currentTime) {
								currentTime = audioNote.start;
							}
							audioNote.start = currentTime - this.getSettingsPlusMinusDuration();
							audioNote.end = currentTime + this.getSettingsPlusMinusDuration();
							this.createNewAudioNoteAtEndOfFile(markdownView, audioNote).catch((error) => {
								console.error(`Audio Notes: ${error}`);
								new Notice("Coud not create audio note at end of file.", 10000);
							});
						}).catch((error: Error) => {
							console.error(`Audio Notes: ${error}`);
							new Notice("Could not find audio note.", 10000)
						});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		this.addCommand({
			id: 'regenerate-current-audio-note',
			name: 'Regenerate Current Audio Note',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						// Note: `.catch` is required (rather than `await ...`) due to the type required by `editorCheckCallback`.
						this.regenerateCurrentAudioNote(markdownView).catch((error) => {
							new Notice("Could not generate audio notes.", 10000)
						});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		this.addCommand({
			id: 'regenerate-audio-notes',
			name: 'Regenerate All Audio Notes',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						// Note: `.catch` is required (rather than `await ...`) due to the type required by `editorCheckCallback`.
						this.regenerateAllAudioNotes(markdownView).catch((error) => {
							new Notice("Could not generate audio notes.", 10000)
						});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// Register the HTML renderer.
		this.registerMarkdownCodeBlockProcessor(
			`audio-note`,
			(src, el, ctx) => this.postprocessor(src, el, ctx)
		);

		console.log("Audio Notes: Obsidian Audio Notes loaded")
	}

	replaceElementWithError(el: HTMLElement, error: Error): void {
		const pre = createEl("pre");
		pre.createEl("code", {
			attr: {
				style: `color: var(--text-error) !important`
			}
		}).createSpan({
			text:
				"There was an error rendering the audio note:\n" +
				error +
				"\n\n" +
				`${error}`
		});
		el.replaceWith(pre);
	}

	async loadFiles(filenames: string[]): Promise<Map<string, string>> {
		const results = new Map<string, string>();
		for (const filename of filenames) {
			const f = this.app.vault.getAbstractFileByPath(filename);
			if (f instanceof TFile) {
				const contents = await this.app.vault.cachedRead(f);
				if (f.path === filename) {
					results.set(filename, contents);
				}
			}
		}
		return results;
	}

	async postprocessor(src: string, el: HTMLElement, ctx?: MarkdownPostProcessorContext) {
		try {
			// Need this for rendering.
			const currentMdFilename =
				typeof ctx == "string"
					? ctx
					: ctx?.sourcePath ??
					this.app.workspace.getActiveFile()?.path ??
					"";

			const audioNote = this.createAudioNoteFromSrc(src);
			const admonitionType = "quote";
			const theDiv = this._createAudioNoteDiv(audioNote, admonitionType, currentMdFilename, ctx);

			// Replace the <pre> tag with the new admonition.
			const parent = el.parentElement;
			if (parent) {
				parent.addClass(
					"admonition-parent",
					`admonition-${admonitionType}-parent`
				);
			}
			el.replaceWith(theDiv);

			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				const playersInSource = this.getAudioHTMLMediaElementsInMode((markdownView as any).modes.source.editorEl);
				const playersInReading = this.getAudioHTMLMediaElementsInMode((markdownView as any).modes.preview.containerEl);
				const generatedAudioDiv = this.getAudioHTMLMediaElementsInMode(theDiv);
				const allPlayers = [...playersInSource, ...playersInReading, ...generatedAudioDiv];
				for (const player of allPlayers) {
					const knownPlayers: HTMLElement[] = this.knownAudioPlayers.get((player.find("audio") as HTMLMediaElement).src);
					const knownPlayerIds: string[] = knownPlayers.map(p => p.id);
					if (!knownPlayerIds.includes(player.id)) {
						knownPlayers.push(player)
					}
				}
			}

			return null;
		} catch (error) {
			console.error(`Audio Notes: ${error}`);
			this.replaceElementWithError(el, error);
		}
	}

	private _createAudioNoteDiv(audioNote: AudioNote, admonitionType: string, currentMdFilename: string, ctx?: MarkdownPostProcessorContext): HTMLElement {
		// Create the main div.
		const admonitionLikeDiv = createDiv({
			cls: `callout admonition admonition-${admonitionType} admonition-plugin audio-note ${""
				}`,
			attr: {
				"data-callout": admonitionType,
				"data-callout-fold": ""
			}
		});

		// Create the title div.
		const titleEl = admonitionLikeDiv.createDiv({
			cls: `audio-note-title ${""
				}`
		});
		const iconEl = titleEl.createDiv(
			"audio-note-icon admonition-title-icon"
		);
		const icon = getIcon("quote-right");
		if (icon !== undefined) {
			iconEl.appendChild(icon);
		}
		const formattedTitle = audioNote.getFormattedTitle();
		const titleInnerEl = titleEl.createDiv("audio-note-title-inner admonition-title-content");
		this.renderMarkdown(titleEl, titleInnerEl, currentMdFilename, undefined, formattedTitle);
		if (titleInnerEl.firstElementChild && titleInnerEl.firstElementChild instanceof HTMLParagraphElement) {
			titleInnerEl.setChildrenInPlace(Array.from(titleInnerEl.firstElementChild.childNodes));
		}

		// Add the quote to the div.
		const contentEl: HTMLDivElement = admonitionLikeDiv.createDiv("callout-content admonition-content");
		let text = "";
		if (audioNote.quote) {
			text += audioNote.quote;
		}
		this.renderMarkdown(admonitionLikeDiv, contentEl, currentMdFilename, ctx, audioNote.quote || "")

		// Add the author to the div.
		if (audioNote.author) {
			const authorEl = admonitionLikeDiv.createDiv({ cls: "audio-note-author" });
			let authorStr = audioNote.author;
			if (authorStr.startsWith("-")) {
				authorStr = `\\${authorStr}`; // prepend a \ to escape the - so it does turn into a bullet point when the HTML renders
			}
			const authorInnerEl = authorEl.createDiv("audio-note-author");
			this.renderMarkdown(authorEl, authorInnerEl, currentMdFilename, undefined, authorStr);
			if (authorInnerEl.firstElementChild) {
				authorInnerEl.setChildrenInPlace(Array.from(authorInnerEl.firstElementChild.childNodes));
			}
		}

		// Create the audio div.
		const audioDiv = this._createAudioDiv(audioNote);
		if (audioDiv === undefined) {
			return admonitionLikeDiv;
		}
		admonitionLikeDiv.appendChild(audioDiv);
		this.renderMarkdown(admonitionLikeDiv, audioDiv, currentMdFilename, ctx, ``);

		return admonitionLikeDiv;
	}

	private _getFullAudioSrcPath(audioNote: AudioNote): string | undefined {
		let audioSrcPath: string | undefined = undefined;
		const tfile = this.app.vault.getAbstractFileByPath(audioNote.audioFilename);
		if (!tfile) {
			console.error(`AudioNotes: Could not find audio file: ${audioNote.audioFilename}`)
			return undefined;
		}
		audioSrcPath = this.app.vault.getResourcePath(tfile as TFile);
		if (audioSrcPath.includes("?")) {
			audioSrcPath = audioSrcPath.slice(0, audioSrcPath.indexOf("?"));
		}
		audioSrcPath += `#t=${secondsToTimeString(audioNote.start, false)}`;
		if (audioNote.end !== Infinity) {
			audioSrcPath += `,${secondsToTimeString(audioNote.end, false)}`;
		}
		return audioSrcPath;
	}

	private _createAudioDiv(audioNote: AudioNote): HTMLElement | undefined {
		/* https://css-tricks.com/lets-create-a-custom-audio-player/
		<div id="audio-player-container">
			<audio src="https://assets.codepen.io/4358584/Anitek_-_Komorebi.mp3" preload="metadata" loop></audio>
			<button id="play-icon"></button>
			<span id="current-time" class="time">0:00</span>
			<input type="range" id="seek-slider" max="100" value="0">
			<span id="duration" class="time">0:00</span>
			<output id="volume-output">100</output>
			<input type="range" id="volume-slider" max="100" value="100">
			<button id="mute-icon"></button>
		</div>
		*/
		const fakeUuid: string = generateRandomString(8);

		const audioSrcPath = this._getFullAudioSrcPath(audioNote);
		if (!audioSrcPath) {
			return undefined;
		}

		const audio = new Audio(audioSrcPath);

		const playButton = createEl("button", { attr: { id: `play-icon-${fakeUuid}` }, cls: "audio-note-play-button" });
		const playIcon = getIcon("play");
		const pauseIcon = getIcon("pause");
		if (playIcon !== undefined) {
			playButton.appendChild(playIcon);
		}

		const seeker = createEl("input", { attr: { id: `seek-slider-${fakeUuid}` }, type: "range", value: "0", cls: "seek-slider" });
		seeker.max = "100";

		const timeSpan = createEl("span", { attr: { id: `current-time-${fakeUuid}` }, cls: "time", text: "0:00" });

		const volumeSlider = createEl("input", { attr: { id: `volume-slider-${fakeUuid}` }, type: "range", value: "100", cls: "volume-slider" });
		volumeSlider.max = "100";

		const muteButton = createEl("button", { attr: { id: `mute-icon-${fakeUuid}` }, cls: "audio-note-mute-button" });
		const mutedIcon = getIcon("volume-off");
		const unmutedIcon = getIcon("volume-up");
		if (unmutedIcon !== undefined) {
			muteButton.appendChild(unmutedIcon);
		}

		const forwardButton = createEl("button", { attr: { id: `forward-button-${fakeUuid}` }, cls: "audio-note-forward-button" });
		const forwardIcon = getIcon("step-forward");
		if (forwardIcon !== undefined) {
			forwardButton.appendChild(forwardIcon);
		}

		const backwardButton = createEl("button", { attr: { id: `backward-button-${fakeUuid}` }, cls: "audio-note-backward-button" });
		const backwardIcon = getIcon("step-backward");
		if (backwardIcon !== undefined) {
			backwardButton.appendChild(backwardIcon);
		}

		const resetTimeButton = createEl("button", { attr: { id: `reset-button-${fakeUuid}` }, cls: "audio-note-reset-button" });
		const resetTimeIcon = getIcon("redo");
		if (resetTimeIcon !== undefined) {
			resetTimeButton.appendChild(resetTimeIcon);
		}

		// Event handlers

		const togglePlayback = () => {
			if (audio.paused) {
				audio.play();
			} else {
				audio.pause();
			}
		};

		playButton.addEventListener('click', togglePlayback);

		muteButton.addEventListener('click', () => {
			if (audio.muted) {
				audio.muted = false;
				if (mutedIcon !== undefined && unmutedIcon !== undefined) {
					mutedIcon.parentNode?.replaceChild(unmutedIcon, mutedIcon);
				}
			} else {
				audio.muted = true;
				if (mutedIcon !== undefined && unmutedIcon !== undefined) {
					unmutedIcon.parentNode?.replaceChild(mutedIcon, unmutedIcon);
				}
			}
		});

		const updateTime = (timeSpan: HTMLSpanElement, audio: HTMLMediaElement) => {
			timeSpan.textContent = secondsToTimeString(audio.currentTime, true) + " / " + secondsToTimeString(audio.duration, true);
		}

		const updateAudio = (audio: HTMLMediaElement, seeker: HTMLInputElement) => {
			audio.currentTime = parseFloat(seeker.value);
		}

		const updateSeeker = (audio: HTMLMediaElement, seeker: HTMLInputElement) => {
			seeker.max = Math.floor(audio.duration).toString();
			seeker.value = audio.currentTime.toString();
		}

		let timeout: NodeJS.Timeout;
		const holdit = (btn: HTMLButtonElement, action: () => void, start: number, speedup: number, forward: boolean) => {
			let mousedownTimeoutStarted = false;
			let currentSpeed = start;

			var repeat = function () {
				action();
				timeout = setTimeout(repeat, currentSpeed);
				if (currentSpeed > 75) { // don't go too fast!
					currentSpeed = currentSpeed / speedup;
				}
			}

			// Supposedly `onpointerup` and `onpointerdown` work on both touch and non touch devices, but I haven't tested.
			if (this.isDesktop) {
				btn.onmousedown = function () {
					mousedownTimeoutStarted = true;
					repeat();
				}

				btn.onmouseup = function () {
					if (timeout) {
						clearTimeout(timeout);
					}
					currentSpeed = start;
				}
			} else {
				btn.onpointerdown = function () {
					mousedownTimeoutStarted = true;
					repeat();
				}

				btn.onpointerup = function () {
					if (timeout) {
						clearTimeout(timeout);
					}
					currentSpeed = start;
				}
				btn.onpointercancel = function () {
					if (timeout) {
						clearTimeout(timeout);
					}
					currentSpeed = start;
				}
			}

			btn.onClickEvent(() => {
				if (!mousedownTimeoutStarted) {
					if (forward) {
						audio.currentTime += this.getSettingsForwardBackwardStep();
					} else {
						audio.currentTime -= this.getSettingsForwardBackwardStep();
					}
					updateTime(timeSpan, audio);
					updateSeeker(audio, seeker);
				}
				mousedownTimeoutStarted = false;
			});
		};

		holdit(forwardButton, () => {
			audio.currentTime += this.getSettingsForwardBackwardStep();
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		}, 500, 1.2, true);

		holdit(backwardButton, () => {
			audio.currentTime -= this.getSettingsForwardBackwardStep();
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		}, 500, 1.2, false);

		resetTimeButton.addEventListener('click', () => {
			if (!audio.paused) {
				audio.pause();
				if (playIcon !== undefined && pauseIcon !== undefined) {
					pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
				}
			}
			audio.currentTime = audioNote.start;
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
			if (timeout) {
				clearTimeout(timeout);
			}
		});

		if (audio.readyState > 0) {
			updateSeeker(audio, seeker);
			updateTime(timeSpan, audio);
		} else {
			audio.addEventListener('loadedmetadata', () => {
				updateSeeker(audio, seeker);
				updateTime(timeSpan, audio);
			});
		}

		audio.addEventListener('timeupdate', (ev: Event) => {
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		});

		audio.addEventListener('play', (ev: Event) => {
			this.currentlyPlayingAudioFakeUuid = fakeUuid;
			if (playIcon !== undefined && pauseIcon !== undefined) {
				playIcon.parentNode?.replaceChild(pauseIcon, playIcon);
			}
			if (timeout) {
				clearTimeout(timeout);
			}
		});

		audio.addEventListener('pause', (ev: Event) => {
			this.currentlyPlayingAudioFakeUuid = null;
			if (playIcon !== undefined && pauseIcon !== undefined) {
				pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
			}
			if (timeout) {
				clearTimeout(timeout);
			}
		});

		audio.addEventListener('ended', (ev: Event) => {
			this.currentlyPlayingAudioFakeUuid = null;
			if (playIcon !== undefined && pauseIcon !== undefined) {
				pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
			}
		});

		seeker.addEventListener('input', () => {
			updateTime(timeSpan, audio);
			updateAudio(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		});

		seeker.addEventListener('change', (ev: Event) => {
			updateTime(timeSpan, audio);
			updateAudio(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		});

		// Always make the space bar toggle the playback
		const overrideSpaceKey = (event: any) => {
			if (event.keyCode === 32) {
				event.preventDefault();
				togglePlayback();
			}
		};
		playButton.onkeydown = overrideSpaceKey;
		backwardButton.onkeydown = overrideSpaceKey;
		forwardButton.onkeydown = overrideSpaceKey;
		resetTimeButton.onkeydown = overrideSpaceKey;

		// Hook into the media session. https://developer.mozilla.org/en-US/docs/Web/API/MediaSession/setActionHandler
		if ('mediaSession' in navigator) {
			let title = audioNote.audioFilename;
			title = title.split(".")[title.split(".").length - 2];
			title = title.split("/")[title.split("/").length - 1];
			title = title.split("\\")[title.split("\\").length - 1];
			navigator.mediaSession.metadata = new MediaMetadata({
				title: title,
			});

			navigator.mediaSession.setActionHandler('play', () => { audio.play(); });
			navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
			navigator.mediaSession.setActionHandler('stop', () => { audio.pause(); });
			navigator.mediaSession.setActionHandler('seekbackward', () => {
				audio.currentTime -= this.getSettingsForwardBackwardStep();
				updateTime(timeSpan, audio);
				updateSeeker(audio, seeker);
			});
			navigator.mediaSession.setActionHandler('seekforward', () => {
				audio.currentTime += this.getSettingsForwardBackwardStep();
				updateTime(timeSpan, audio);
				updateSeeker(audio, seeker);
			});
			navigator.mediaSession.setActionHandler('seekto', (ev: any) => {
				audio.currentTime = ev.seekTime;
				updateTime(timeSpan, audio);
				updateSeeker(audio, seeker);
			});
		}

		// Create the container div.
		if (this.isDesktop) { // desktop
			const audioPlayerContainer = createDiv({ attr: { id: `audio-player-container-${fakeUuid}` }, cls: "audio-player-container" })
			audioPlayerContainer.appendChild(audio);
			audioPlayerContainer.appendChild(playButton);
			audioPlayerContainer.appendChild(seeker);
			audioPlayerContainer.appendChild(timeSpan);
			audioPlayerContainer.appendChild(backwardButton);
			audioPlayerContainer.appendChild(forwardButton);
			audioPlayerContainer.appendChild(resetTimeButton);
			audioPlayerContainer.appendChild(muteButton);
			return audioPlayerContainer;
		} else { // mobile
			const audioPlayerContainer = createDiv({ attr: { id: `audio-player-container-${fakeUuid}` }, cls: "audio-player-container-mobile" })
			const topDiv = createDiv({ cls: "audio-player-container-top" });
			const bottomDiv = createDiv({ cls: "audio-player-container-bottom" });
			topDiv.appendChild(audio);
			topDiv.appendChild(playButton);
			topDiv.appendChild(seeker);
			bottomDiv.appendChild(timeSpan);
			bottomDiv.appendChild(backwardButton);
			bottomDiv.appendChild(forwardButton);
			bottomDiv.appendChild(resetTimeButton);
			topDiv.appendChild(muteButton);
			audioPlayerContainer.appendChild(topDiv);
			audioPlayerContainer.appendChild(bottomDiv);
			return audioPlayerContainer;
		}
	}

	renderMarkdown(parent: HTMLElement, obj: HTMLElement, sourcePath: string, ctx: MarkdownPostProcessorContext | undefined, withText: string): void {
		const markdownRenderChild = this._createMarkdownRenderChildWithCtx(obj, ctx);
		MarkdownRenderer.renderMarkdown(withText, parent, sourcePath, markdownRenderChild);
	}

	private _createMarkdownRenderChildWithCtx(element: HTMLElement, ctx: MarkdownPostProcessorContext | undefined): MarkdownRenderChild {
		const markdownRenderChild = new MarkdownRenderChild(element);
		markdownRenderChild.containerEl = element;
		if (ctx && !(typeof ctx == "string")) {
			ctx.addChild(markdownRenderChild);
		}
		return markdownRenderChild;
	}

	getAudioNoteBlocks(fileContents: string, limit: number = Infinity): AudioNoteWithPositionInfo[] {
		const currentMdContentLines = fileContents.split(/\r?\n/);
		// [startLineNumber, endLineNumber, endChNumber, srcLines]
		const allAudioNoteCodeBlockStrings: ([number, number, number, string[]])[] = [];
		let inAudioCodeBlock = false;
		for (let i = 0; i < currentMdContentLines.length; i++) {
			const line = currentMdContentLines[i];
			if (inAudioCodeBlock) {
				if (line.trim() === "```") {
					inAudioCodeBlock = false;
					allAudioNoteCodeBlockStrings[allAudioNoteCodeBlockStrings.length - 1][1] = i; // endLineNumber
					allAudioNoteCodeBlockStrings[allAudioNoteCodeBlockStrings.length - 1][2] = currentMdContentLines[i - 1].length; // endChNumber
				} else {
					allAudioNoteCodeBlockStrings[allAudioNoteCodeBlockStrings.length - 1][3].push(line);
				}
			}
			if (line.trim() === "```audio-note") {
				allAudioNoteCodeBlockStrings.push([i, undefined as any, undefined as any, []]);
				inAudioCodeBlock = true;
			}
			if (allAudioNoteCodeBlockStrings.length >= limit && !inAudioCodeBlock) {
				break;
			}
		}

		const allAudioNotes: AudioNoteWithPositionInfo[] = [];
		for (const [startLineNumber, endLineNumber, endChNumber, lines] of allAudioNoteCodeBlockStrings) {
			const audioNote = this.createAudioNoteFromSrc(lines.join("\n"));
			const audioNoteWithPositionInfo = AudioNoteWithPositionInfo.fromAudioNote(audioNote, startLineNumber, endLineNumber, endChNumber);
			allAudioNotes.push(audioNoteWithPositionInfo);
		}

		return allAudioNotes;
	}

	private _getStartAndEndFromBracketString(timeInfo: string): [number, number] {
		if (timeInfo.startsWith("t=")) {
			timeInfo = timeInfo.slice(2, undefined);
		}
		if (timeInfo.startsWith("[")) {
			timeInfo = timeInfo.slice(1, undefined);
		}
		if (timeInfo.endsWith("]")) {
			timeInfo = timeInfo.slice(0, timeInfo.length - 1);
		}
		let start = undefined;
		let end = undefined;
		if (timeInfo.includes(",")) {
			[start, end] = timeInfo.split(",")
			start = timeStringToSeconds(start);
			end = timeStringToSeconds(end);
		} else {
			start = timeStringToSeconds(timeInfo);
			end = Infinity;
		}
		return [start, end];
	}

	createAudioNoteFromSrc(src: string): AudioNote {
		const lines = src.split(/\r?\n/);
		let title = undefined;
		let author = undefined;
		let audioLine = undefined;
		let transcriptFilename = undefined;
		let quoteCreatedForLine = undefined;
		let quoteLines: string[] = [];
		let quoteHasStarted = false;
		for (const line of lines) {
			if (quoteHasStarted) {
				quoteLines.push(line);
			} else if (line.startsWith("title:")) {
				title = line.split(":").slice(1, undefined).join(":").trim();
			} else if (line.startsWith("author:")) {
				author = line.split(":").slice(1, undefined).join(":").trim();
			} else if (line.startsWith("audio:")) {
				audioLine = line.split(":").slice(1, undefined).join(":").trim();
			} else if (line.startsWith("transcript:")) {
				transcriptFilename = line.split(":").slice(1, undefined).join(":").trim();
			} else if (line.trim() === "---") {
				quoteHasStarted = true;
			}
		}
		if (audioLine === undefined) {
			new Notice("No audio file defined for audio note.", 10000);
			throw new Error("No audio file defined");
		}

		const extendAudio = audioLine.includes("!");
		let audioFilename = undefined;
		let start = undefined;
		let end = undefined;
		if (!audioLine.includes("#")) {
			audioFilename = audioLine;
			start = 0;
			end = Infinity;
		} else {
			audioFilename = audioLine.split("#")[0];
			const timeInfo = audioLine.split("#")[1];
			[start, end] = this._getStartAndEndFromBracketString(timeInfo);
		}

		// Go through the lines in the quote, and for any that start with a `-`, prepend the escape character.
		for (let i = 0; i < quoteLines.length; i++) {
			if (quoteLines[i].startsWith("-")) {
				quoteLines[i] = `\\${quoteLines[i]}`
			}
		}
		const quote = quoteLines.join("\n").trim() || undefined;
		let quoteCreatedForStart = undefined;
		let quoteCreatedForEnd = undefined;
		if (quoteCreatedForLine) {
			[quoteCreatedForStart, quoteCreatedForEnd] = this._getStartAndEndFromBracketString(quoteCreatedForLine);
		}

		const audioNote = new AudioNote(title, author, audioFilename, start, end, transcriptFilename, quoteCreatedForStart, quoteCreatedForEnd, quote, extendAudio);
		return audioNote;
	}

	createAudioNoteSrc(audioNote: AudioNote, transcript: string | undefined, view: MarkdownView): string | undefined {
		if (audioNote.quote && audioNote.quote.includes("`")) {
			new Notice("Before the generation can be run, you must remove any audio notes that have the character ` in their quote.", 10000);
			return undefined;
		}
		if (audioNote.start >= audioNote.end) {
			new Notice("An audio note has a start time that is after the end time. Fix it!", 10000);
			return undefined;
		}
		// Get the new quote.
		if (!transcript) {
			console.error(`Audio Notes: Could not find transcript: ${audioNote.transcriptFilename}`);
			new Notice(`Could not find transcript: ${audioNote.transcriptFilename}`), 10000;
		}

		const sourceView = view.contentEl.querySelector(".markdown-source-view");
		if (!sourceView) {
			console.error(`Audio Notes: Must be in editor mode.`);
			new Notice(`Must be in editor mode.`), 10000;
			return undefined;
		}

		let start = audioNote.start;
		let end = audioNote.end;
		let newQuote = "";
		if (transcript) {
			let quoteStart = undefined;
			let quoteEnd = undefined;
			[quoteStart, quoteEnd, newQuote] = this._getQuoteFromTranscript(start, end, transcript);
			if (audioNote.extendAudio) {
				start = quoteStart;
				end = quoteEnd;
			}
		}

		// Create the new audio note text.
		let newAudioNoteText = `audio: ${audioNote.audioFilename}`;
		if (start) {
			newAudioNoteText += `#t=${secondsToTimeString(start, false)}`;
			if (end !== Infinity) {
				newAudioNoteText += `,${secondsToTimeString(end, false)}`;
			}
		}
		newAudioNoteText += `\n`;
		newAudioNoteText += `title: ${audioNote.title}\n`
		newAudioNoteText += `transcript: ${audioNote.transcriptFilename}\n`
		// newAudioNoteText += `quote-created-for: [${secondsToTimeString(start, false)},${secondsToTimeString(end, false)}]\n`;
		newAudioNoteText += `---\n`
		newAudioNoteText += `${newQuote}`;
		return newAudioNoteText;
	}

	private _getQuoteFromTranscript(quoteStart: number, quoteEnd: number, transcriptContents: string): [number, number, string] {
		// Get the relevant part of the transcript.
		const transcript = JSON.parse(transcriptContents); // For now, use the file format defined by OpenAI Whisper
		const segments = transcript.segments;
		const result = [];
		let start = undefined;
		let end = undefined;
		for (let segment of segments) {
			const text = segment.text;
			const segmentStart = segment.start;
			const segmentEnd = segment.end;
			// If either the segment's start or end is inside the range specified by the user...
			if ((quoteStart <= segmentStart && segmentStart < quoteEnd) || (quoteStart < segmentEnd && segmentEnd <= quoteEnd)) {
				result.push(text);
				if (start === undefined) {
					start = segmentStart;
				}
				end = segmentEnd;
			}
			// If the range specified by the user is entirely within the segment...
			if (quoteStart >= segmentStart && quoteEnd <= segmentEnd) {
				result.push(text);
				if (start === undefined) {
					start = segmentStart;
				}
				end = segmentEnd;
			}
		}
		let quoteText = result.join(" ").trim();
		if (quoteText) {
			// For some reason double spaces are often in the text. Remove them because they get removed by the HTML rendering anyway.
			let i = 0;
			while (quoteText.includes("  ")) {
				quoteText = quoteText.replace(new RegExp("  "), " ");
				// Make sure we don't hit an infinite loop, even though it should be impossible.
				i += 1;
				if (i > 100) {
					break;
				}
			}
		}
		return [start, end, quoteText];
	}

	async getFirstAudioNoteInFile(file: TFile): Promise<AudioNote> {
		const fileContents = await this.app.vault.read(file);
		const audioNotes: AudioNote[] = this.getAudioNoteBlocks(fileContents, 1);
		return audioNotes[0];
	}

	async createNewAudioNoteAtEndOfFile(view: MarkdownView, audioNote: AudioNote): Promise<void> {
		let transcript: string | undefined = undefined;
		if (audioNote.transcriptFilename !== undefined) {
			const translationFilesContents = await this.loadFiles([audioNote.transcriptFilename]);
			transcript = translationFilesContents.get(audioNote.transcriptFilename);
		}

		const newAudioNoteSrc = this.createAudioNoteSrc(audioNote, transcript, view);
		if (newAudioNoteSrc) {
			this.app.vault.append(view.file, "\n```audio-note\n" + newAudioNoteSrc + "\n```\n");
			new Notice("Created new audio note", 3000);
		}
		return undefined;
	}

	getAudioHTMLMediaElementsInMode(mode: HTMLElement): HTMLElement[] {
		const _players = mode.getElementsByClassName("audio-player-container");
		const players: HTMLElement[] = [];
		for (let i = 0; i < _players.length; i++) {
			players.push(_players[i] as HTMLElement);
		}
		return players;
	}

	async regenerateAllAudioNotes(view: MarkdownView) {
		new Notice('Regenerating All Audio Notes...');

		// Get the file contents of the current markdown file.
		const currentMdFilename = view.file.path;
		const fileContents = await this.loadFiles([currentMdFilename]);
		const currentMdFileContents = fileContents.get(currentMdFilename);
		if (currentMdFileContents === undefined) {
			console.error(`Audio Notes: Could not find current .md: ${currentMdFilename}...? This should be impossible.`);
			return undefined;
		}
		const audioNotes: AudioNoteWithPositionInfo[] = this.getAudioNoteBlocks(currentMdFileContents);

		// Load the transcripts.
		const translationFilenames: string[] = [];
		for (const audioNote of audioNotes) {
			if (!audioNote.transcriptFilename) {
				continue;
			}
			if ((audioNote.needsToBeUpdated) && !translationFilenames.includes(audioNote.transcriptFilename)) {
				translationFilenames.push(audioNote.transcriptFilename);
			}
		}
		const translationFilesContents = await this.loadFiles(translationFilenames);

		// Must go from bottom to top so the editor position doesn't change!
		audioNotes.reverse()
		for (const audioNote of audioNotes) {
			if (audioNote.needsToBeUpdated) {
				if (!audioNote.transcriptFilename) {
					new Notice("No transcript file defined for audio note.", 10000);
					continue;
				}
				const transcript = translationFilesContents.get(audioNote.transcriptFilename);

				const newAudioNoteSrc = this.createAudioNoteSrc(audioNote, transcript, view);
				if (newAudioNoteSrc) {
					const [srcStart, srcEnd] = this._getAudioNoteStartAndEndPositionInEditor(audioNote);
					// Perform the replacement.
					if (srcStart && srcEnd) {
						view.editor.replaceRange(newAudioNoteSrc, srcStart, srcEnd);
					}
				}
			}
		}

		// Tell the user the generation is complete.
		new Notice('Audio Note generation complete!');
	}

	// Identify the start and end position of the audio note in the .md file.
	private _getAudioNoteStartAndEndPositionInEditor(audioNote: AudioNoteWithPositionInfo): [{ line: number, ch: number }, { line: number, ch: number }] | [undefined, undefined] {
		// Update the view.editor.
		if (audioNote.startLineNumber === undefined || audioNote.endLineNumber === undefined || audioNote.endChNumber === undefined) {
			console.error(`Audio Notes: Could not find line numbers of audio-note...? This should be impossible.`)
			return [undefined, undefined];
		}

		const startLine = audioNote.startLineNumber + 1;
		const startCh = 0;
		const endLine = audioNote.endLineNumber - 1;
		const endCh = audioNote.endChNumber;
		const srcStart = { line: startLine, ch: startCh };
		const srcEnd = { line: endLine, ch: endCh };
		return [srcStart, srcEnd];
	}

	async regenerateCurrentAudioNote(view: MarkdownView) {
		new Notice('Regenerating Current Audio Note...');

		// Get the file contents of the current markdown file.
		const currentMdFilename = view.file.path;
		const fileContents = await this.loadFiles([currentMdFilename]);
		const currentMdFileContents = fileContents.get(currentMdFilename);
		if (currentMdFileContents === undefined) {
			console.error(`Audio Notes: Could not find current .md: ${currentMdFilename}...? This should be impossible.`);
			return undefined;
		}
		const audioNotes: AudioNoteWithPositionInfo[] = this.getAudioNoteBlocks(currentMdFileContents);

		// Get the editor's current position
		const from = view.editor.getCursor("from");
		const to = view.editor.getCursor("to");

		// Identify which audio note the user's cursor is in.
		let audioNote: AudioNoteWithPositionInfo | undefined = undefined;
		for (const note of audioNotes) {
			// There are two cases, one of which we will ignore. The one we are ignoring is when the user highlights the entirety of a note.
			// The other case, which we will cover, is when the user's cusor/selection is entirely within a note.
			if (from.line >= note.startLineNumber && from.ch >= 0 && to.line <= note.endLineNumber && to.ch <= note.endChNumber) {
				audioNote = note;
				break
			}
		}
		if (audioNote === undefined) {
			console.warn("Audio Notes: The user's cursor is not inside an audio note")
			new Notice("Please place your cursor inside the Audio Note you want to generate", 10000);
			return undefined;
		}
		if (audioNote.quote) {
			console.warn("Audio Notes: The user tried to generate an audio note with an existing quote")
			new Notice("Please delete the quote for the audio note before regenerating it", 10000);
			return undefined;
		}

		// Load the transcript.
		if (!audioNote.transcriptFilename) {
			return;
		}
		let transcript: string | undefined = undefined;
		if (audioNote.transcriptFilename !== undefined) {
			const translationFilesContents = await this.loadFiles([audioNote.transcriptFilename]);
			transcript = translationFilesContents.get(audioNote.transcriptFilename);
		}

		const newAudioNoteSrc = this.createAudioNoteSrc(audioNote, transcript, view);
		if (newAudioNoteSrc) {
			const [srcStart, srcEnd] = this._getAudioNoteStartAndEndPositionInEditor(audioNote);
			// Perform the replacement.
			if (srcStart && srcEnd) {
				view.editor.replaceRange(newAudioNoteSrc, srcStart, srcEnd);
			}
			new Notice("Created new audio note", 3000);
		}

		// Tell the user the generation is complete.
		new Notice('Audio Note generation complete!');
	}

	onunload() {
		this.knownCurrentTimes.clear();;
		this.knownAudioPlayers.clear();
		this.currentlyPlayingAudioFakeUuid = null;
	}
}