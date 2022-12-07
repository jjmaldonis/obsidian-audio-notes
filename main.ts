import {
	MarkdownView,
	Plugin,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownRenderChild,
	Notice,
	TFile,
	Platform,
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
			viewableStartTime = secondsToTimeString(Math.round(this.start), false);
			if (viewableStartTime.startsWith("0")) {
				viewableStartTime = viewableStartTime.slice(1, undefined);
			}

			viewableEndTime = secondsToTimeString(Math.round(this.end), false);
			if (viewableEndTime.startsWith("0")) {
				viewableEndTime = viewableEndTime.slice(1, undefined);
			}
		} else {
			if (this.start !== 0) {
				viewableStartTime = secondsToTimeString(Math.round(this.start), false);
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

export default class AutomaticAudioNotes extends Plugin {
	knownCurrentTimes: Map<string, number> = new Map();
	knownAudioPlayers: DefaultMap<string, HTMLElement[]> = new DefaultMap(() => []);
	currentlyPlayingAudioFakeUuid: string | null = null;

	updateCurrentTimeOfAudio(audio: HTMLMediaElement): void {
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
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'generate-audio-notes',
			name: 'Generate Audio Notes',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						// Note: `.cache` is required (rather than `await ...`) due to the type required by `editorCheckCallback`.
						this.regenerateAllAudioNotes(markdownView).catch((error) => {
							new Notice("Could not generate audio notes.", 10000)
						});
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'create-new-audio-note',
			name: 'Create new Audio Note at current time (+/- 30 seconds)',
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						// Note: `.cache` is required (rather than `await ...`) due to the type required by `editorCheckCallback`.
						this.getFirstAudioNoteInFile(markdownView.file).then((audioNote: AudioNote) => {
							const audioElements = this.getAudioHTMLMediaElementsInMode(markdownView.currentMode as any);
							const firstAudioElement = audioElements[0].find("audio")! as HTMLMediaElement;
							audioNote.start = firstAudioElement.currentTime - 30;
							audioNote.end = firstAudioElement.currentTime + 30;
							this.createNewAudioNoteAtEndOfFile(markdownView, audioNote).catch((error) => {
								console.error(error);
								new Notice("Coud not create audio note at end of file.", 10000);
							});
						}).catch((error) => {
							console.error(error);
							new Notice("Could not find audio note.", 10000)
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

			/*  I wanted to use this to synchronize the playback times between live preview and reading modes, but it doesn't seem to be possible.
				I would have to give each audio-note a unique ID, but that isn't a good user experience.
				I could assume that each note has a unique `src`, but that may not be true in practice. What are the results if I do assume this?
				  The time/seek slider would change in audio notes where they shouldn't. That isn't all that big of a deal.
				  There will also be a weird bug if users delete a src and readd the same src, because the currentTime will change on the new src.
			*/
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
			console.error(error);
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
					src
			});

			el.replaceWith(pre);
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
		let audioSrcPath: string | undefined = undefined;
		const tfile = this.app.vault.getAbstractFileByPath(audioNote.audioFilename);
		if (!tfile) {
			console.error(`Could not find audio file: ${audioNote.audioFilename}`)
			return admonitionLikeDiv;
		}
		audioSrcPath = this.app.vault.getResourcePath(tfile as TFile);
		if (audioSrcPath.includes("?")) {
			audioSrcPath = audioSrcPath.slice(0, audioSrcPath.indexOf("?"));
		}
		audioSrcPath += `#t=${secondsToTimeString(audioNote.start, false)}`;
		if (audioNote.end !== Infinity) {
			audioSrcPath += `,${secondsToTimeString(audioNote.end, false)}`;
		}

		const audioDiv = this._createAudioDiv(audioSrcPath, audioNote);
		admonitionLikeDiv.appendChild(audioDiv);
		this.renderMarkdown(admonitionLikeDiv, audioDiv, currentMdFilename, ctx, ``);

		return admonitionLikeDiv;
	}

	private _createAudioDiv(src: string, audioNote: AudioNote): HTMLElement {
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

		const audio = new Audio(src);

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
				if (playIcon !== undefined && pauseIcon !== undefined) {
					playIcon.parentNode?.replaceChild(pauseIcon, playIcon);
				}
			} else {
				audio.pause();
				if (playIcon !== undefined && pauseIcon !== undefined) {
					pauseIcon.parentNode?.replaceChild(playIcon, pauseIcon);
				}
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

		const forwardBackwardStep: number = 15; // in seconds

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

		const holdit = (btn: HTMLButtonElement, action: () => void, start: number, speedup: number, forward: boolean) => {
			let timeout: NodeJS.Timeout;
			let mousedownTimeoutStarted = false;
			let currenSpeed = start;

			var repeat = function () {
				action();
				timeout = setTimeout(repeat, currenSpeed);
				if (currenSpeed > 75) { // don't go too fast!
					currenSpeed = currenSpeed / speedup;
				}
			}

			btn.onmousedown = function () {
				mousedownTimeoutStarted = true;
				repeat();
			}

			btn.onmouseup = function () {
				clearTimeout(timeout);
				currenSpeed = start;
			}

			btn.onClickEvent(() => {
				if (!mousedownTimeoutStarted) {
					if (forward) {
						audio.currentTime += forwardBackwardStep;
					} else {
						audio.currentTime -= forwardBackwardStep;
					}
					updateTime(timeSpan, audio);
					updateSeeker(audio, seeker);
				}
				mousedownTimeoutStarted = false;
			});
		};

		holdit(forwardButton, () => {
			audio.currentTime += forwardBackwardStep;
			updateTime(timeSpan, audio);
			updateSeeker(audio, seeker);
			this.updateCurrentTimeOfAudio(audio);
		}, 500, 1.2, true);

		holdit(backwardButton, () => {
			audio.currentTime -= forwardBackwardStep;
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
		});

		audio.addEventListener('pause', (ev: Event) => {
			this.currentlyPlayingAudioFakeUuid = null;
		});

		audio.addEventListener('ended', (ev: Event) => {
			this.currentlyPlayingAudioFakeUuid = null;
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

		// Create the container div.
		if (Platform.isDesktop || Platform.isDesktopApp || Platform.isMacOS) { // desktop
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
			console.error(src);
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
		let quote = quoteLines.join("\n").trim() || undefined;
		if (quote) {
			quote = quote.replace(new RegExp("  "), " ");  // For some reason double spaces are often in the text. Remove them because they get removed by the HTML rendering anyway.
		}
		let quoteCreatedForStart = undefined;
		let quoteCreatedForEnd = undefined;
		if (quoteCreatedForLine) {
			[quoteCreatedForStart, quoteCreatedForEnd] = this._getStartAndEndFromBracketString(quoteCreatedForLine);
		}

		const audioNote = new AudioNote(title, author, audioFilename, start, end, transcriptFilename, quoteCreatedForStart, quoteCreatedForEnd, quote, extendAudio);
		return audioNote;
	}

	async regenerateAllAudioNotes(view: MarkdownView) {
		new Notice('Generating Audio Notes...');

		// Get the file contents of the current markdown file.
		const currentMdFilename = view.file.path;
		const fileContents = await this.loadFiles([currentMdFilename]);
		const currentMdFileContents = fileContents.get(currentMdFilename);
		if (currentMdFileContents === undefined) {
			console.error(`Could not find current .md: ${currentMdFilename}...? This should be impossible.`);
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

	createAudioNoteSrc(audioNote: AudioNote, transcript: string | undefined, view: MarkdownView): string | undefined {
		if (!audioNote.transcriptFilename) {
			new Notice("No transcript file defined for audio note.", 10000);
			return undefined;
		}
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
			console.error(`Could not find transcript: ${audioNote.transcriptFilename}`);
			new Notice(`Could not find transcript: ${audioNote.transcriptFilename}`), 10000;
			return undefined;
		}

		const sourceView = view.contentEl.querySelector(".markdown-source-view");
		if (!sourceView) {
			console.error(`Must be in editor mode.`);
			new Notice(`Must be in editor mode.`), 10000;
			return undefined;
		}

		let start = audioNote.start;
		let end = audioNote.end;
		const [quoteStart, quoteEnd, newQuote] = this._getQuoteFromTranscript(start, end, transcript);
		if (audioNote.extendAudio) {
			start = quoteStart;
			end = quoteEnd;
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
		const quoteText = result.join(" ").trim();
		return [start, end, quoteText];
	}

	// Identify the start and end position of the audio note in the .md file.
	private _getAudioNoteStartAndEndPositionInEditor(audioNote: AudioNoteWithPositionInfo): [{ line: number, ch: number }, { line: number, ch: number }] | [undefined, undefined] {
		// Update the view.editor.
		if (audioNote.startLineNumber === undefined || audioNote.endLineNumber === undefined || audioNote.endChNumber === undefined) {
			console.error(`Could not find line numbers of audio-note...? This should be impossible.`)
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

	async getFirstAudioNoteInFile(file: TFile): Promise<AudioNote> {
		const fileContents = await this.app.vault.read(file);
		const audioNotes: AudioNote[] = this.getAudioNoteBlocks(fileContents, 1);
		return audioNotes[0];
	}

	async createNewAudioNoteAtEndOfFile(view: MarkdownView, audioNote: AudioNote): Promise<void> {
		if (!audioNote.transcriptFilename) {
			new Notice("No transcript file defined for audio note.", 10000);
			return undefined;
		}
		const translationFilesContents = await this.loadFiles([audioNote.transcriptFilename]);
		const transcript = translationFilesContents.get(audioNote.transcriptFilename);

		const newAudioNoteSrc = this.createAudioNoteSrc(audioNote, transcript, view);
		if (newAudioNoteSrc) {
			this.app.vault.append(view.file, "```audio-note\n" + newAudioNoteSrc + "\n```\n");
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

	getAudioBlockFromHTMLMediaElement(el: HTMLMediaElement): AudioBlockWithCurrentTime {
		let audioFilename = undefined;
		let start = undefined;
		let end = undefined;
		if (!el.src.includes("#")) {
			audioFilename = el.src;
			start = 0;
			end = Infinity;
		} else {
			audioFilename = el.src.split("#")[0];
			const timeInfo = el.src.split("#")[1];
			[start, end] = this._getStartAndEndFromBracketString(timeInfo);
		}

		return new AudioBlockWithCurrentTime(audioFilename, start, end, el.currentTime);
	}

	onunload() { }
}