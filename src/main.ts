import {
	MarkdownView,
	Plugin,
	MarkdownPostProcessorContext,
	Notice,
	TFile,
	Platform,
	request,
	WorkspaceLeaf,
	MarkdownRenderer,
} from 'obsidian';

// Local imports
import { monkeyPatchConsole } from './monkeyPatchConsole';
import { CreateNewAudioNoteInNewFileModal } from './CreateNewAudioNoteInNewFileModal';
import { EnqueueAudioModal } from './EnqueueAudioModal';
import { generateRandomString, getIcon, secondsToTimeString, getUniqueId } from './utils';
import { AudioNotesSettings, AudioNotesSettingsTab } from './AudioNotesSettings';
import { AudioElementCache, AudioNote, AudioNoteWithPositionInfo, getAudioPlayerIdentify, getStartAndEndFromBracketString } from './AudioNotes';
import { Transcript, parseTranscript, TranscriptsCache, TranscriptSegment } from './Transcript';

// Load Font-Awesome stuff
import { library } from "@fortawesome/fontawesome-svg-core";
import { faCopy, far } from "@fortawesome/free-regular-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { fab } from "@fortawesome/free-brands-svg-icons";
// Load the actual library so the icons render.
library.add(fas, far, fab, faCopy);


export default class AutomaticAudioNotes extends Plugin {
	settings: AudioNotesSettings;
	transcriptDatastore: TranscriptsCache;
	knownCurrentTimes: Map<string, number> = new Map();
	knownAudioPlayers: AudioElementCache = new AudioElementCache(30);
	currentlyPlayingAudioFakeUuid: string | null = null;
	atLeastOneNoteRendered: boolean = false;

	private get isDesktop(): boolean {
		return Platform.isDesktop || Platform.isDesktopApp || Platform.isMacOS;
	}

	async loadSettings() {
		this.settings = AudioNotesSettings.overrideDefaultSettings(await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	private getCurrentlyPlayingAudioElement(): HTMLMediaElement | null {
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

	/* Keep track of each source's current time, and update any other audio players with the same source. */
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

	/**
	 * Persist the position of the audio on disk so it gets loaded at the time the user left off when the restart the app.
	 * As of writing this, the position is only written to disk when the user interacts with a player using the play/pause/
	 * reset buttons or when the audio ends.
	 */
	async saveCurrentPlayerPosition(audio: HTMLMediaElement | null | undefined): Promise<void> {
		if (!audio) {
			audio = this.getCurrentlyPlayingAudioElement();
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

	async onload() {
		// Load Settings
		await this.loadSettings();
		this.addSettingTab(new AudioNotesSettingsTab(this.app, this));
		// Go through the loaded settings and set the timestamps of any src's that have been played in the last 3 months.
		// Resave the data after filtering out any src's that were played more than 3 months ago.
		const todayMinusThreeMonthsInMilliseconds = (new Date()).getTime() - 7.884e+9;
		let data = await this.loadData();
		if (!data) {
			data = new Object();
		}
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
		// Make the UUID is set in the data.json file. It doesn't need to be a perfect UUID, so we don't need a package for it.
		if (!data.uuid) {
			data.uuid = getUniqueId(4);
			this.saveData(data);
		}

		// Create the TranscriptsCache
		this.transcriptDatastore = new TranscriptsCache(this.settings, this.loadFiles.bind(this));

		// Log to log.txt file if on mobile and debugging mode is enabled.
		if (!this.isDesktop && this.settings.debugMode) {
			monkeyPatchConsole(this);
		}

		// Add all the commands
		this.addCommand({
			id: 'create-new-audio-note',
			name: `Create new Audio Note at current time (+/- ${this.settings.plusMinusDuration} seconds)`,
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (checking) {
						// This command will only show up in Command Palette when the check function returns true
						return true;
					} else {
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
							audioNote.start = currentTime - this.settings.plusMinusDuration;
							audioNote.end = currentTime + this.settings.plusMinusDuration;
							this.createNewAudioNoteAtEndOfFile(markdownView, audioNote).catch((error) => {
								console.error(`Audio Notes: ${error}`);
								new Notice("Coud not create audio note at end of file.", 10000);
							});
							this._updateCounts();
						}).catch((error: Error) => {
							console.error(`Audio Notes: ${error}`);
							new Notice("Could not find audio note.", 10000);
						});
					}
				}
			}
		});

		this.addCommand({
			id: "create-audio-note-from-media-extended-plugin",
			name: `(Media Extended YouTube Video) Create new Audio Note at current time (+/- ${this.settings.plusMinusDuration} seconds)`,
			checkCallback: (checking: boolean) => {
				// https://github.com/aidenlx/media-extended/blob/1e8f37756403423cd100e51f58d27ed961acf56b/src/mx-main.ts#L120
				type MediaView = any;
				const getMediaView = (group: string) =>
					this.app.workspace
						.getGroupLeaves(group)
						.find((leaf) => (leaf.view as MediaView).getTimeStamp !== undefined)
						?.view as MediaView | undefined;

				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				let group: WorkspaceLeaf | undefined = undefined;
				if (markdownView) {
					group = (markdownView.leaf as any).group;
				}
				if (checking) {
					if (group) {
						return true;
					} else {
						return false;
					}
				} else {
					if (group) {
						const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
						if (markdownView) {
							const mediaView = getMediaView(group.toString());
							const notTimestamp = mediaView.getTimeStamp(); // this is NOT just a timestamp...
							let url: string = mediaView.info.src.href;
							if (url.includes("youtube.com")) {
								// Remove all query params from the YouTube URL except v={id}
								const urlParts = url.split("?");
								const urlParams: Map<string, string> = new Map();
								for (const param of urlParts[1].split("&")) {
									const [key, value] = param.split("=");
									urlParams.set(key, value);
								}
								url = `${urlParts[0]}?v=${urlParams.get("v")}`;
								// Make a request to get the title of the YouTube video.
								request({
									url: `https://www.youtube.com/oembed?format=json&url=${url}`,
									method: 'GET',
									contentType: 'application/json',
								}).then((result: string) => {
									// Finally, create the Audio Note at the end of the file.
									const videoInfo = JSON.parse(result);
									const title = videoInfo.title;
									const currentTime = parseFloat(notTimestamp.split("#t=")[1].slice(0, -1));
									const audioNote = new AudioNote(
										title, notTimestamp, url,
										currentTime - this.settings.plusMinusDuration, currentTime + this.settings.plusMinusDuration, 1.0,
										url,
										undefined, undefined, undefined,
										false, false
									);
									this.createNewAudioNoteAtEndOfFile(markdownView, audioNote).catch((error) => {
										console.error(`Audio Notes: ${error}`);
										new Notice("Coud not create audio note at end of file.", 10000);
									});
									this._updateCounts();
								});
							} else {
								new Notice("Currently, only YouTube videos are supported.")
							}
						} else {
							new Notice("Please focus your cursor on a markdown window.");
						}
					} else {
						new Notice("Use the command `Media Extended: Open Media from Link` to open a YouTube video.");
					}
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
						this._updateCounts();
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
						this._updateCounts();
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
				const mp3Files = allFiles.filter((file: TFile) => file.extension === "mp3" || file.extension === "m4b" || file.extension === "m4a");
				new CreateNewAudioNoteInNewFileModal(this.app, mp3Files, this.settings.audioNotesApiKey, this.settings.getInfoByApiKey()).open();
				this._updateCounts();
			}
		});

		this.addCommand({
			id: 'toggle-play',
			name: 'Toggle Play/Pause',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayingAudioElement();
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
				const audioPlayer = this.getCurrentlyPlayingAudioElement();
				if (audioPlayer) {
					audioPlayer.currentTime -= this.settings.backwardStep;
				}
			}
		});

		this.addCommand({
			id: 'skip-forward',
			name: 'Skip Forward',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayingAudioElement();
				if (audioPlayer) {
					audioPlayer.currentTime += this.settings.forwardStep;
				}
			}
		});

		this.addCommand({
			id: 'slow-down-playback',
			name: 'Slow Down Playback',
			callback: async () => {
				const audioPlayer = this.getCurrentlyPlayingAudioElement();
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
				const audioPlayer = this.getCurrentlyPlayingAudioElement();
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
				const audioPlayer = this.getCurrentlyPlayingAudioElement();
				if (audioPlayer) {
					const audioLine = audioPlayer.src;
					let start = 0;
					if (audioLine.includes("#")) {
						const timeInfo = audioLine.split("#")[1];
						[start, ,] = getStartAndEndFromBracketString(timeInfo);
					}
					audioPlayer.currentTime = start;
				}
			}
		});

		this.addCommand({
			id: 'add-audio-file-to-queue',
			name: 'Transcribe mp3 file online',
			callback: async () => {
				new EnqueueAudioModal(this.app, this.settings.audioNotesApiKey, this.settings.getInfoByApiKey()).open();
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

	private async _updateCounts() {
		const data = await this.loadData();
		data.counts = (data.counts || 0) + 1;
		this.saveData(data);
	}

	private async _onFirstRender() {
		const data = await this.loadData();
		const uuid = data.uuid;
		const counts = data.counts || 0;
		if (counts > 0) {
			request({
				url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/init',
				method: 'POST',
				body: `{"uuid": "${uuid}", "counts": ${counts}}`
			});
		}
	}

	private _replaceElementWithError(el: HTMLElement, error: Error): void {
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

	private async loadFiles(filenames: string[]): Promise<Map<string, string>> {
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

	private async postprocessor(src: string, el: HTMLElement, ctx?: MarkdownPostProcessorContext) {
		try {
			// Need this for rendering.
			const currentMdFilename =
				typeof ctx == "string"
					? ctx
					: ctx?.sourcePath ??
					this.app.workspace.getActiveFile()?.path ??
					"";

			const audioNote = AudioNote.fromSrc(src);
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

			if (!this.atLeastOneNoteRendered) {
				this.atLeastOneNoteRendered = true;
				this._onFirstRender();
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
		MarkdownRenderer.renderMarkdown(formattedTitle, titleInnerEl, currentMdFilename, this);
		// The below if statement is useful because it takes the rendered text and inserts it directly into
		// the title component as the `titleInnerEl.textContent`. If we just set the `.textContent` directly,
		// the markdown text doesn't get rendered properly.
		if (titleInnerEl.firstElementChild && titleInnerEl.firstElementChild instanceof HTMLParagraphElement) {
			titleInnerEl.setChildrenInPlace(Array.from(titleInnerEl.firstElementChild.childNodes));
		}

		// Add the quote to the div.
		const contentEl: HTMLDivElement = calloutDiv.createDiv("callout-content");
		if (audioNote.quote) {
			MarkdownRenderer.renderMarkdown(audioNote.quote, contentEl, currentMdFilename, this);
		} else {
			contentEl.createEl("p"); // This won't get created if the quote is `""`, so we need to create it automatically for the liveUpdate to populate it.
		}

		// Add the author to the div.
		if (audioNote.author) {
			const authorEl = calloutDiv.createDiv({ cls: "audio-note-author" });
			let authorStr = audioNote.author;
			if (authorStr.startsWith("-")) {
				authorStr = `\\${authorStr}`; // prepend a \ to escape the - so it does turn into a bullet point when the HTML renders
			}
			const authorInnerEl = authorEl.createDiv("audio-note-author");
			MarkdownRenderer.renderMarkdown(authorStr, authorInnerEl, currentMdFilename, this);
		}

		// Create the audio player div.
		if (!audioNote.audioFilename.includes("youtube.com")) {
			const [audio, audioDiv] = this._createAudioPlayerDiv(audioNote);
			if (audioDiv === undefined || audio === undefined) {
				return calloutDiv;
			}
			calloutDiv.appendChild(audioDiv);
			MarkdownRenderer.renderMarkdown(``, calloutDiv, currentMdFilename, this);

			// Enable Live Update. This has to be here because we need access to both the HTML quote element and the audio div.
			if (audioNote.liveUpdate) {
				audio.addEventListener('play', () => {
					this.liveUpdateTranscript(contentEl.firstChild as HTMLParagraphElement, audioNote, audio);
				});
			}
		}

		return calloutDiv;
	}

	private liveUpdateTranscript(quoteEl: HTMLParagraphElement, audioNote: AudioNote, audioPlayer: HTMLMediaElement) {
		this.transcriptDatastore.getTranscript(audioNote.transcriptFilename).then((transcript: Transcript | undefined) => {
			if (transcript) {
				const currentTime = audioPlayer.currentTime;
				const [i, segment] = transcript.getSegmentAt(currentTime);
				if (i && segment) {
					quoteEl.textContent = segment.text;

					// Make a new callback
					const makeCallback = (transcript: Transcript, i: number) => {
						const nextSegment = transcript.segments[i + 1]; // returns `undefined` if index is out of range
						if (nextSegment !== undefined) {
							const callback = () => {
								if (audioPlayer.currentTime >= nextSegment.start) {
									quoteEl.textContent = nextSegment.text;
									audioPlayer.removeEventListener('timeupdate', callback);
									const newCallback = makeCallback(transcript, i + 1);
									if (newCallback) {
										newCallback();
									}
								}
							};
							audioPlayer.addEventListener('timeupdate', callback)
							return callback;
						}
						return undefined;
					}

					const newCallback = makeCallback(transcript, i);
					if (newCallback) {
						newCallback();
					}

				} // end of if (i && segment) statement
			}
		});
	}

	/**
	 * Figures out the true audio src's path, and appends the player's start/end time to it.
	 * The src can be an http(s) link, or a local file.
	 */
	private _getFullAudioSrcPath(audioNote: AudioNote): string | undefined {
		let audioSrcPath: string | undefined = undefined;
		// If the filename is a link, don't look for it in the vault.
		if (audioNote.audioFilename.startsWith("https") || audioNote.audioFilename.startsWith("http")) {
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

	/**
	 * Render the custom audio player itself, and hook up all the buttons to perform the correct functionality.
	 */
	private _createAudioPlayerDiv(audioNote: AudioNote): [HTMLMediaElement | undefined, HTMLElement | undefined] {
		const fakeUuid: string = generateRandomString(8);

		const audioSrcPath = this._getFullAudioSrcPath(audioNote);
		if (!audioSrcPath) {
			return [undefined, undefined];
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

		// Create a function that, when the user presses and holds the forward or back button, the forward/back
		// amount increases as the user holds it down, up to a maximum rate.
		let holdForwardBackwardTimeout: NodeJS.Timeout;
		const holdit = (btn: HTMLButtonElement, action: () => void, start: number, speedup: number, forward: boolean) => {
			let mousedownTimeoutStarted = false;
			let currentSpeed = start;

			const repeat = function () {
				action();
				holdForwardBackwardTimeout = setTimeout(repeat, currentSpeed);
				if (currentSpeed > 75) { // don't go too fast!
					currentSpeed = currentSpeed / speedup;
				}
			}

			// Supposedly `onpointerup` and `onpointerdown` work on both touch and non touch devices, but I haven't tested.
			if (this.isDesktop) { // For Desktop
				btn.onmousedown = function () {
					mousedownTimeoutStarted = true;
					repeat();
				}

				btn.onmouseup = function () {
					if (holdForwardBackwardTimeout) {
						clearTimeout(holdForwardBackwardTimeout);
					}
					currentSpeed = start;
				}
			} else { // For Mobile
				btn.onpointerdown = function () {
					mousedownTimeoutStarted = true;
					repeat();
				}

				btn.onpointerup = function () {
					if (holdForwardBackwardTimeout) {
						clearTimeout(holdForwardBackwardTimeout);
					}
					currentSpeed = start;
				}
				btn.onpointercancel = function () {
					if (holdForwardBackwardTimeout) {
						clearTimeout(holdForwardBackwardTimeout);
					}
					currentSpeed = start;
				}
			}

			btn.onClickEvent(() => {
				if (!mousedownTimeoutStarted) {
					if (forward) {
						audio.currentTime += this.settings.forwardStep;
					} else {
						audio.currentTime -= this.settings.backwardStep;
					}
					updateTime(timeSpan, audio);
					updateSeeker(audio, seeker);
				}
				mousedownTimeoutStarted = false;
			});
		};

		// Apply the `holdit` functionality to the forward button
		holdit(forwardButton, () => {
			audio.currentTime += this.settings.forwardStep;
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		}, 500, 1.2, true);

		// Apply the `holdit` functionality to the backward button
		holdit(backwardButton, () => {
			audio.currentTime -= this.settings.backwardStep;
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		}, 500, 1.2, false);

		// Reset the audio player's state when the reset button is pressed.
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
			if (holdForwardBackwardTimeout) {
				clearTimeout(holdForwardBackwardTimeout);
			}
			this.saveCurrentPlayerPosition(audio);  // Persist the audio's time
		});

		// When the audio player is ready to play, update its seeker position and the note's current time.
		if (audio.readyState > 0) {
			updateSeeker(audio, seeker);
			updateTime(timeSpan, audio);
		} else {
			audio.addEventListener('loadedmetadata', () => {
				updateSeeker(audio, seeker);
				updateTime(timeSpan, audio);
			});
		}

		audio.addEventListener('play', (ev: Event) => {
			this.currentlyPlayingAudioFakeUuid = fakeUuid;
			// Flip the play/pause button.
			if (playIcon !== undefined && pauseIcon !== undefined) {
				playIcon.parentNode?.replaceChild(pauseIcon, playIcon);
			}
			if (holdForwardBackwardTimeout) {
				clearTimeout(holdForwardBackwardTimeout);
			}
			this.saveCurrentPlayerPosition(audio);  // Persist the audio's time
		});

		audio.addEventListener('pause', (ev: Event) => {
			// this.currentlyPlayingAudioFakeUuid = null;
			// Flip the play/pause button.
			if (playIcon !== undefined && pauseIcon !== undefined) {
				pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
			}
			if (holdForwardBackwardTimeout) {
				clearTimeout(holdForwardBackwardTimeout);
			}
			this.saveCurrentPlayerPosition(audio);  // Persist the audio's time
		});

		audio.addEventListener('ended', (ev: Event) => {
			// this.currentlyPlayingAudioFakeUuid = null;
			if (playIcon !== undefined && pauseIcon !== undefined) {
				pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
			}
			this.saveCurrentPlayerPosition(audio);  // Persist the audio's time
		});

		// When the audio player's time is updated, update the note's current time and the audio player's position.
		audio.addEventListener('timeupdate', (ev: Event) => {
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
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
				audio.currentTime -= this.settings.backwardStep;
				updateTime(timeSpan, audio);
				updateSeeker(audio, seeker);
			});
			navigator.mediaSession.setActionHandler('seekforward', () => {
				audio.currentTime += this.settings.forwardStep;
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
			return [audio, audioPlayerContainer];
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
			return [audio, audioPlayerContainer];
		}
	}

	/* Look through the .md file's contents and parse out any audio notes in it. */
	private getAudioNoteBlocks(fileContents: string, limit: number = Infinity): AudioNoteWithPositionInfo[] {
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
			const audioNote = AudioNote.fromSrc(lines.join("\n"));
			const audioNoteWithPositionInfo = AudioNoteWithPositionInfo.fromAudioNote(audioNote, startLineNumber, endLineNumber, endChNumber);
			allAudioNotes.push(audioNoteWithPositionInfo);
		}

		return allAudioNotes;
	}

	private async getFirstAudioNoteInFile(file: TFile): Promise<AudioNote> {
		const fileContents = await this.app.vault.read(file);
		const audioNotes: AudioNote[] = this.getAudioNoteBlocks(fileContents, 1);
		return audioNotes[0];
	}

	private async createNewAudioNoteAtEndOfFile(view: MarkdownView, audioNote: AudioNote): Promise<void> {
		let transcript: Transcript | undefined = await this.transcriptDatastore.getTranscript(audioNote.transcriptFilename);

		const newAudioNoteSrc = audioNote.toSrc(transcript);
		if (newAudioNoteSrc) {
			this.app.vault.append(view.file, "\n```audio-note\n" + newAudioNoteSrc + "\n```\n");
			new Notice("Created new audio note", 3000);
		}
		return undefined;
	}

	private getAudioHTMLMediaElementsInMode(mode: HTMLElement): HTMLElement[] {
		const _players = mode.getElementsByClassName("audio-player-container");
		const players: HTMLElement[] = [];
		for (let i = 0; i < _players.length; i++) {
			players.push(_players[i] as HTMLElement);
		}
		return players;
	}

	private async regenerateAllAudioNotes(view: MarkdownView) {
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
		const transcriptContents = await this.loadFiles(translationFilenames);
		const transcripts: Map<string, Transcript> = new Map();
		for (const [filename, contents] of transcriptContents.entries()) {
			transcripts.set(filename, parseTranscript(contents));
		}

		// Must go from bottom to top so the editor position doesn't change!
		audioNotes.reverse()
		for (const audioNote of audioNotes) {
			if (audioNote.needsToBeUpdated) {
				if (!audioNote.transcriptFilename) {
					new Notice("No transcript file defined for audio note.", 10000);
					continue;
				}
				let transcript = transcripts.get(audioNote.transcriptFilename);
				if (transcript === undefined) {
					transcript = await this.transcriptDatastore.getTranscript(audioNote.transcriptFilename);
				}

				const newAudioNoteSrc = audioNote.toSrc(transcript);
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

	private async regenerateCurrentAudioNote(view: MarkdownView) {
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
		let transcript: Transcript | undefined = await this.transcriptDatastore.getTranscript(audioNote.transcriptFilename);

		const newAudioNoteSrc = audioNote.toSrc(transcript);
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

	public onunload() {
		this.knownCurrentTimes.clear();;
		this.knownAudioPlayers.clear();
		this.currentlyPlayingAudioFakeUuid = null;
		this.transcriptDatastore.cache.clear();
	}
}
