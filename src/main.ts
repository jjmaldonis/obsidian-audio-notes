import {
	MarkdownView,
	Plugin,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownRenderChild,
	Notice,
	TFile,
	Platform,
	Editor,
	request,
} from 'obsidian';

// Local imports
import { monkeyPatchConsole } from './monkeyPatchConsole';
import { CreateNewAudioNoteInNewFileModal } from './CreateNewAudioNoteInNewFileModal';
import { ApiKeyInfo, EnqueueAudioModal } from './EnqueueAudioModal';
import { generateRandomString, getIcon, secondsToTimeString, timeStringToSeconds } from './utils';
import { AudioNotesSettings, AudioNotesSettingsTab, DEFAULT_SETTINGS } from './AudioNotesSettings';
import { AudioElementCache, AudioNote, AudioNoteWithPositionInfo, getAudioPlayerIdentify } from './AudioNotes';

// Load Font-Awesome stuff
import { library } from "@fortawesome/fontawesome-svg-core";
import { faCopy, far } from "@fortawesome/free-regular-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
// Load the actual library so the icons render.
library.add(fas, far, fab, faCopy);


export default class AutomaticAudioNotes extends Plugin {
	settings: AudioNotesSettings;
	knownCurrentTimes: Map<string, number> = new Map();
	knownAudioPlayers: AudioElementCache = new AudioElementCache(30);
	currentlyPlayingAudioFakeUuid: string | null = null;

	private getCurrentlyPlayerAudioElement(): HTMLMediaElement | null {
		if (this.currentlyPlayingAudioFakeUuid) {
			const knownPlayers = this.knownAudioPlayers.getAudioContainersWithTheSameSrc(this.currentlyPlayingAudioFakeUuid);
			for (const knownPlayer of knownPlayers) {
				const knownPlayerFakeUuid = getAudioPlayerIdentify(knownPlayer);
				if (knownPlayerFakeUuid === this.currentlyPlayingAudioFakeUuid) {
					const player = (knownPlayer.find("audio")! as HTMLMediaElement);
					if (player) {
						return player;
					}
				}
			}
		}
		// If there is only one known media player, return it.
		const allPlayers: HTMLElement[] = [];
		for (const [fakeUuid, players] of this.knownAudioPlayers.entries()) {
			allPlayers.push(...players);
		}
		if (allPlayers.length === 1) {
			const player = (allPlayers[0].find("audio")! as HTMLMediaElement);
			return player;
		}
		throw new Error(`Could not find currently playing audio with ID: ${this.currentlyPlayingAudioFakeUuid}`);
	}

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

	getSettingsBackwardStep(): number {
		return parseFloat(this.settings.backwardStep);
	}

	getSettingsForwardStep(): number {
		return parseFloat(this.settings.forwardStep);
	}

	getSettingsOpenAiApiKey(): string {
		return this.settings.openAiApiKey;
	}

	getSettingsAudioNotesApiKey(): string {
		return this.settings.audioNotesApiKey;
	}

	getSettingsDebugMode(): boolean {
		return this.settings.debugMode;
	}

	updateCurrentTimeOfAudio(audio: HTMLMediaElement): void {
		// There is a minor bug if users delete a src and readd the same src, because the currentTime will change on the new src.
		this.knownCurrentTimes.set(audio.src, audio.currentTime);
		const knownAudios = this.knownAudioPlayers.getAudioContainersWithTheSameSrc(getAudioPlayerIdentify(audio));
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
		// Log to log.txt file if on mobile and debugging mode is enabled.
		if (!this.isDesktop && this.getSettingsDebugMode()) {
			monkeyPatchConsole(this);
		}

		// Load Settings
		await this.loadSettings();
		this.addSettingTab(new AudioNotesSettingsTab(this.app, this));
		// Go through the loaded settings and set the timestamps of any src's that have been played in the last 3 months.
		// Resave the data after filtering out any src's that were played more than 3 months ago.
		const todayMinusThreeMonthsInMilliseconds = (new Date()).getTime() - 7.884e+9;
		const data = await this.loadData();
		if (data) {
			const positions = data.positions as Object;
			const newPositions = new Object() as any;
			if (positions) {
				for (const [src, pair] of Array.from(Object.entries(positions))) { // shallow copy the entries for iteration
					const [time, updatedAt] = pair as [number, number];
					if (updatedAt > todayMinusThreeMonthsInMilliseconds) {
						this.knownCurrentTimes.set(src, time);
						newPositions[src] = [time, updatedAt];
					}
				}
			}
			data.positions = newPositions;
			this.saveData(data);
		}

		// Add all the commands
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
						// async via .then().catch() blocks
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
							new Notice("Could not find audio note.", 10000);
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
						// async via .then().catch() blocks
						this.regenerateCurrentAudioNote(markdownView).catch((error) => {
							new Notice("Could not generate audio notes.", 10000);
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
						// async via .then().catch() blocks
						this.regenerateAllAudioNotes(markdownView).catch((error) => {
							new Notice("Could not generate audio notes.", 10000);
						});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		this.addCommand({
			id: 'create-new-audio-note-with-new-file',
			name: 'Create new Audio Note in new file',
			callback: async () => {
				const allFiles = this.app.vault.getFiles();
				const mp3Files = allFiles.filter((file: TFile) => file.extension === "mp3");
				new CreateNewAudioNoteInNewFileModal(this.app, mp3Files).open();
			}
		});

		this.addCommand({
			id: 'summarize-using-openai',
			name: 'Summarize Selection using OpenAI',
			editorCallback: async (editor: Editor, view: MarkdownView) => {
				const selectedText = editor.getSelection();
				const summaryPrompt = `Summarize this text into one paragraph.\n\nText:\n${selectedText}\n\nSummary:\n`
				// const summaryPrompt = `Summarize this text into one paragraph, emphasizing accuracy.\n\nText:\n${selectedText}\n\nSummary:\n`
				const summary = await this.summarizeTextUsingOpenAI(summaryPrompt);
				if (summary) {
					editor.replaceSelection(`${selectedText}\n> Summary: ${summary}`);
				}
			}
		});

		this.addCommand({
			id: 'toggle-play',
			name: 'Toggle Play/Pause',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayerAudioElement();
				if (audioPlayer) {
					if (audioPlayer.paused || audioPlayer.ended) {
						audioPlayer.play();
					} else {
						audioPlayer.pause();
					}
				}
			}
		});

		this.addCommand({
			id: 'skip-backward',
			name: 'Skip Backward',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayerAudioElement();
				if (audioPlayer) {
					audioPlayer.currentTime -= this.getSettingsBackwardStep();
				}
			}
		});

		this.addCommand({
			id: 'skip-forward',
			name: 'Skip Forward',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayerAudioElement();
				if (audioPlayer) {
					audioPlayer.currentTime += this.getSettingsForwardStep();
				}
			}
		});

		this.addCommand({
			id: 'slow-down-playback',
			name: 'Slow Down Playback',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayerAudioElement();
				if (audioPlayer) {
					audioPlayer.playbackRate -= 0.1;
					new Notice(`Set playback speed to ${Math.round(audioPlayer.playbackRate * 10) / 10}`, 1000);
				}
			}
		});

		this.addCommand({
			id: 'speed-up-playback',
			name: 'Speed Up Playback',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayerAudioElement();
				if (audioPlayer) {
					audioPlayer.playbackRate += 0.1;
					new Notice(`Set playback speed to ${Math.round(audioPlayer.playbackRate * 10) / 10}`, 1000);
				}
			}
		});

		this.addCommand({
			id: 'reset-player',
			name: 'Reset Audio to Start',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayerAudioElement();
				if (audioPlayer) {
					const audioLine = audioPlayer.src;
					let start = 0;
					if (audioLine.includes("#")) {
						const timeInfo = audioLine.split("#")[1];
						[start, ,] = this._getStartAndEndFromBracketString(timeInfo);
					}
					audioPlayer.currentTime = start;
				}
			}
		});

		this.addCommand({
			id: 'add-audio-file-to-queue',
			name: 'Transcribe mp3 file online',
			callback: async () => {
				new EnqueueAudioModal(this.app, this.getSettingsAudioNotesApiKey(), this.getInfoByApiKey()).open();
			}
		});

		// Register the HTML renderer.
		this.registerMarkdownCodeBlockProcessor(
			`audio-note`,
			(src, el, ctx) => this.postprocessor(src, el, ctx)
		);

		// Done!
		console.log("Audio Notes: Obsidian Audio Notes loaded")
	}

	_replaceElementWithError(el: HTMLElement, error: Error): void {
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
			const theDiv = this._createAudioNoteDiv(audioNote, currentMdFilename, ctx);

			// Replace the <pre> tag with the new callout div.
			el.replaceWith(theDiv);

			const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (markdownView) {
				const playersInSource = this.getAudioHTMLMediaElementsInMode((markdownView as any).modes.source.editorEl);
				const playersInReading = this.getAudioHTMLMediaElementsInMode((markdownView as any).modes.preview.containerEl);
				const generatedAudioDiv = this.getAudioHTMLMediaElementsInMode(theDiv);
				const allPlayers = [...playersInSource, ...playersInReading, ...generatedAudioDiv];
				for (const player of allPlayers) {
					this.knownAudioPlayers.add(player);
				}
			}

			return null;
		} catch (error) {
			console.error(`Audio Notes: ${error}`);
			this._replaceElementWithError(el, error);
		}
	}

	private _createAudioNoteDiv(audioNote: AudioNote, currentMdFilename: string, ctx?: MarkdownPostProcessorContext): HTMLElement {
		// Create the main div.
		const calloutDiv = createDiv({
			cls: `callout audio-note ${""
				}`,
			attr: {
				"data-callout": "quote",
				"data-callout-fold": ""
			}
		});

		// Create the title div.
		const titleEl = calloutDiv.createDiv({
			cls: `audio-note-title ${""
				}`
		});
		const iconEl = titleEl.createDiv(
			"audio-note-icon"
		);
		const icon = getIcon("quote-right");
		if (icon !== undefined) {
			iconEl.appendChild(icon);
		}
		const formattedTitle = audioNote.getFormattedTitle();
		const titleInnerEl = titleEl.createDiv("audio-note-title-inner");
		this.renderMarkdown(titleEl, titleInnerEl, currentMdFilename, undefined, formattedTitle);
		if (titleInnerEl.firstElementChild && titleInnerEl.firstElementChild instanceof HTMLParagraphElement) {
			titleInnerEl.setChildrenInPlace(Array.from(titleInnerEl.firstElementChild.childNodes));
		}

		// Add the quote to the div.
		const contentEl: HTMLDivElement = calloutDiv.createDiv("callout-content");
		let text = "";
		if (audioNote.quote) {
			text += audioNote.quote;
		}
		this.renderMarkdown(calloutDiv, contentEl, currentMdFilename, ctx, audioNote.quote || "")

		// Add the author to the div.
		if (audioNote.author) {
			const authorEl = calloutDiv.createDiv({ cls: "audio-note-author" });
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
			return calloutDiv;
		}
		calloutDiv.appendChild(audioDiv);
		this.renderMarkdown(calloutDiv, audioDiv, currentMdFilename, ctx, ``);

		return calloutDiv;
	}

	private _getFullAudioSrcPath(audioNote: AudioNote): string | undefined {
		let audioSrcPath: string | undefined = undefined;
		// If the filename is a link, don't look for it in the vault.
		if (audioNote.audioFilename.startsWith("https")) {
			audioSrcPath = audioNote.audioFilename;
		} else {
			// If the file isn't a link, look for it in the vault and get its full file path.
			const tfile = this.app.vault.getAbstractFileByPath(audioNote.audioFilename);
			if (!tfile) {
				console.error(`AudioNotes: Could not find audio file: ${audioNote.audioFilename}`)
				return undefined;
			}
			audioSrcPath = this.app.vault.getResourcePath(tfile as TFile);
		}
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
		audio.id = `audio-player-${fakeUuid}`;
		audio.playbackRate = audioNote.speed;
		// If the start time isn't set, set it to the last known playback time to resume playback.
		if (!audioNote.audioFilename.includes("#t=")) {
			audio.currentTime = this.knownCurrentTimes.get(audio.src) || 0;
		}

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

			const repeat = function () {
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
						audio.currentTime += this.getSettingsForwardStep();
					} else {
						audio.currentTime -= this.getSettingsBackwardStep();
					}
					updateTime(timeSpan, audio);
					updateSeeker(audio, seeker);
				}
				mousedownTimeoutStarted = false;
			});
		};

		holdit(forwardButton, () => {
			audio.currentTime += this.getSettingsForwardStep();
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		}, 500, 1.2, true);

		holdit(backwardButton, () => {
			audio.currentTime -= this.getSettingsBackwardStep();
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
			this.saveCurrentPlayerPosition(audio);
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
			this.saveCurrentPlayerPosition(audio);
		});

		audio.addEventListener('pause', (ev: Event) => {
			// this.currentlyPlayingAudioFakeUuid = null;
			if (playIcon !== undefined && pauseIcon !== undefined) {
				pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
			}
			if (timeout) {
				clearTimeout(timeout);
			}
			this.saveCurrentPlayerPosition(audio);
		});

		audio.addEventListener('ended', (ev: Event) => {
			// this.currentlyPlayingAudioFakeUuid = null;
			if (playIcon !== undefined && pauseIcon !== undefined) {
				pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
			}
			this.saveCurrentPlayerPosition(audio);
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
				audio.currentTime -= this.getSettingsBackwardStep();
				updateTime(timeSpan, audio);
				updateSeeker(audio, seeker);
			});
			navigator.mediaSession.setActionHandler('seekforward', () => {
				audio.currentTime += this.getSettingsForwardStep();
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
		let audioPlayerContainerClasses = "audio-player-container";
		if (this.isDesktop) { // desktop
			const audioPlayerContainer = createDiv({ attr: { id: `audio-player-container-${fakeUuid}` }, cls: audioPlayerContainerClasses })
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
			audioPlayerContainerClasses += " audio-player-container-mobile"
			const audioPlayerContainer = createDiv({ attr: { id: `audio-player-container-${fakeUuid}` }, cls: audioPlayerContainerClasses })
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

	private _getStartAndEndFromBracketString(timeInfo: string): [number, number, number] {
		const split = timeInfo.split("&");
		let start = undefined;
		let end = undefined;
		let speed = undefined;
		for (let queryParam of split) {
			if (queryParam.startsWith("t=")) {
				queryParam = queryParam.slice(2, undefined);
				if (queryParam.includes(",")) {
					[start, end] = queryParam.split(",")
					start = timeStringToSeconds(start);
					end = timeStringToSeconds(end);
				} else {
					start = timeStringToSeconds(queryParam);
					end = Infinity;
				}
			}
			if (queryParam.startsWith("s=")) {
				queryParam = queryParam.slice(2, undefined);
				speed = parseFloat(queryParam);
			}
		}
		if (speed === undefined) {
			speed = 1.0;
		}
		if (start === undefined) {
			start = 0;
		}
		if (end === undefined) {
			end = Infinity;
		}
		return [start, end, speed];
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
		let speed = undefined;
		if (!audioLine.includes("#")) {
			audioFilename = audioLine;
			start = 0;
			end = Infinity;
			speed = 1.0;
		} else {
			audioFilename = audioLine.split("#")[0];
			const timeInfo = audioLine.split("#")[1];
			[start, end, speed] = this._getStartAndEndFromBracketString(timeInfo);
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
			[quoteCreatedForStart, quoteCreatedForEnd,] = this._getStartAndEndFromBracketString(quoteCreatedForLine);
		}

		const audioNote = new AudioNote(title, author, audioFilename, start, end, speed, transcriptFilename, quoteCreatedForStart, quoteCreatedForEnd, quote, extendAudio);
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
			new Notice(`Could not find transcript: ${audioNote.transcriptFilename}`, 10000);
		}

		if (view.getMode() !== "source") {
			console.error(`Audio Notes: Must be in editor mode.`);
			new Notice(`Must be in editor mode.`, 10000);
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
		if (audioNote.speed !== 1.0) {
			if (newAudioNoteText.includes("#")) {
				newAudioNoteText += `&s=${audioNote.speed}`
			} else {
				newAudioNoteText += `#s=${audioNote.speed}`
			}
		}
		newAudioNoteText += `\n`;
		newAudioNoteText += `title: ${audioNote.title}\n`
		newAudioNoteText += `transcript: ${audioNote.transcriptFilename}\n`
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

	async getInfoByApiKey(): Promise<ApiKeyInfo | undefined> {
		const apiKey = this.getSettingsAudioNotesApiKey();
		if (apiKey) {
			const infoString: string = await request({
				url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/users/byapikey',
				method: 'GET',
				headers: {
					'x-api-key': this.getSettingsAudioNotesApiKey(),
				},
				contentType: 'application/json',
			});
			return JSON.parse(infoString) as ApiKeyInfo;
		} else {
			return undefined;
		}
	}

	async getTranscript(transcriptFilename: string | undefined, checkFiles: boolean = true): Promise<string | undefined> {
		let transcript: string | undefined = undefined;
		if (transcriptFilename !== undefined) {
			if (checkFiles) {
				const translationFilesContents = await this.loadFiles([transcriptFilename]);
				transcript = translationFilesContents.get(transcriptFilename);
			}
			if (transcript === undefined) {
				transcript = await request({
					url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/transcriptions',
					method: 'GET',
					headers: {
						'x-api-key': this.getSettingsAudioNotesApiKey(),
						"url": transcriptFilename,
					},
					contentType: 'application/json',
				});
			}
		}
		return transcript;
	}

	async createNewAudioNoteAtEndOfFile(view: MarkdownView, audioNote: AudioNote): Promise<void> {
		let transcript: string | undefined = await this.getTranscript(audioNote.transcriptFilename);

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
				let transcript = translationFilesContents.get(audioNote.transcriptFilename);
				if (transcript === undefined) {
					transcript = await this.getTranscript(audioNote.transcriptFilename, false);
				}

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
		let transcript: string | undefined = await this.getTranscript(audioNote.transcriptFilename);

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

	async summarizeTextUsingOpenAI(toSummarize: string): Promise<string | undefined> {
		// Some basic info about summarization, with an example API call, can be found here: https://beta.openai.com/examples/default-tldr-summary

		// For English text, 1 token is approximately 4 characters or 0.75 words.
		const fractionOfPrompt: number = 0.5;
		const minCharacters = 75;
		const maxCharacters = 500;
		let tokens = Math.ceil(toSummarize.length * fractionOfPrompt);
		if (tokens < minCharacters) {
			tokens = minCharacters;
		} else if (tokens > maxCharacters) {
			tokens = maxCharacters;
		}
		// Convert from characters to tokens.
		tokens = Math.floor(tokens / 4);

		// https://beta.openai.com/docs/models/gpt-3
		const model = "text-davinci-003" // the best
		// const model = "text-curie-001" // also good at summarization

		try {
			// console.info(`Summarizing text:\n${toSummarize}\nwith max length of ${tokens * 4} characters, or ${tokens} tokens, or ~ ${tokens * 0.75} words.`)
			new Notice("Summarizing text using OpenAI ...", 3000);
			const response = await request({
				url: 'https://api.openai.com/v1/completions',
				method: 'POST',
				headers: {
					'Authorization': `Bearer ${this.getSettingsOpenAiApiKey()}`,
					'Content-Type': 'application/json'
				},
				contentType: 'application/json',
				body: JSON.stringify({
					"model": model,
					"prompt": toSummarize,
					"max_tokens": tokens,
					"temperature": 0.3,
					"best_of": 3,
					"n": 1,
				})
			});

			const json = JSON.parse(response);
			const result: string = json.choices[0].text;
			// console.info(`Result is:\n${result}\nwith ${result.length} characters and ${result.split(/\s/).length} words.`)
			return result;
		} catch (error) {
			console.error(error);
			new Notice(`Could not summarize text: ${error}`, 3000);
			return undefined;
		}
	}

	onunload() {
		this.knownCurrentTimes.clear();;
		this.knownAudioPlayers.clear();
		this.currentlyPlayingAudioFakeUuid = null;
	}

	async saveCurrentPlayerPosition(audio: HTMLMediaElement | null | undefined): Promise<void> {
		if (!audio) {
			audio = this.getCurrentlyPlayerAudioElement();
		}
		if (audio) {
			let data = await this.loadData();
			if (!data) {
				data = new Object();
			}
			if (!data.positions) {
				data.positions = new Object();
			}
			data.positions[audio.currentSrc] = [audio.currentTime, (new Date()).getTime()];
			await this.saveData(data);
		}
	}
}
