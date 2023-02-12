import { Notice } from "obsidian";
import { Transcript } from "./Transcript";
import { DefaultMap, secondsToTimeString, timeStringToSeconds } from "./utils";


/* A helper method to get the start/end/speed info from an audio note src's text. */
export function getStartAndEndFromBracketString(timeInfo: string): [number, number, number] {
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


export const getAudioPlayerIdentify = (element: HTMLElement): string => {
	const knownPlayerFakeUuid = element.id.split("-")[element.id.split("-").length - 1];
	if (!knownPlayerFakeUuid) {
		throw new Error("Could not find audio's identifier from the above element.")
	}
	return knownPlayerFakeUuid;
}


export class AudioBlock {
	constructor(
		public audioFilename: string,
		private _start: number,
		private _end: number,
		private _speed: number,
	) { }

	get start(): number {
		return this._start;
	}

	set start(value: number) {
		if (value < 0) {
			value = 0;
		}
		this._start = value;
	}

	get end(): number {
		return this._end;
	}

	set end(value: number) {
		// There is no way to check the duration of the audio file unfortunately.
		this._end = value;
	}

	get speed(): number {
		return this._speed;
	}

	set speed(value: number) {
		this._speed = value;
	}
}

export class AudioBlockWithCurrentTime extends AudioBlock {
	constructor(
		audioFilename: string,
		start: number,
		end: number,
		speed: number,
		public currentTime: number,
	) {
		super(audioFilename, start, end, speed);
	}
}

export class AudioNote extends AudioBlock {
	constructor(
		public title: string | undefined,
		public author: string | undefined,
		public audioFilename: string,
		_start: number, // defaults to 0
		_end: number, // defaults to Infinity
		_speed: number,
		public transcriptFilename: string | undefined,
		public quoteCreatedForStart: number | undefined,
		public quoteCreatedForEnd: number | undefined,
		public quote: string | undefined,
		public extendAudio: boolean,
	) {
		super(audioFilename, _start, _end, _speed);
	}

	/* Given the text representation of an audio note that a user writes, create an AudioNote object. */
	static fromSrc(src: string): AudioNote {
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
			[start, end, speed] = getStartAndEndFromBracketString(timeInfo);
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
			[quoteCreatedForStart, quoteCreatedForEnd,] = getStartAndEndFromBracketString(quoteCreatedForLine);
		}

		const audioNote = new AudioNote(title, author, audioFilename, start, end, speed, transcriptFilename, quoteCreatedForStart, quoteCreatedForEnd, quote, extendAudio);
		return audioNote;
	}

	toSrc(transcript: Transcript | undefined): string | undefined {
		if (this.quote && this.quote.includes("`")) {
			new Notice("Before the generation can be run, you must remove any audio notes that have the character ` in their quote.", 10000);
			return undefined;
		}
		if (this.start >= this.end) {
			new Notice("An audio note has a start time that is after the end time. Fix it!", 10000);
			return undefined;
		}
		// Get the new quote.
		if (!transcript) {
			console.error(`Audio Notes: Could not find transcript: ${this.transcriptFilename}`);
			new Notice(`Could not find transcript: ${this.transcriptFilename}`, 10000);
		}

		let start = this.start;
		let end = this.end;
		let newQuote = "";
		if (transcript) {
			let quoteStart = undefined;
			let quoteEnd = undefined;
			[quoteStart, quoteEnd, newQuote] = transcript.getQuote(start, end);
			if (this.extendAudio) {
				start = quoteStart;
				end = quoteEnd;
			}
		}

		// Create the new audio note text.
		let newAudioNoteText = `audio: ${this.audioFilename}`;
		if (start) {
			newAudioNoteText += `#t=${secondsToTimeString(start, false)}`;
			if (end !== Infinity) {
				newAudioNoteText += `,${secondsToTimeString(end, false)}`;
			}
		}
		if (this.speed !== 1.0) {
			if (newAudioNoteText.includes("#")) {
				newAudioNoteText += `&s=${this.speed}`
			} else {
				newAudioNoteText += `#s=${this.speed}`
			}
		}
		newAudioNoteText += `\n`;
		newAudioNoteText += `title: ${this.title}\n`;
		newAudioNoteText += `transcript: ${this.transcriptFilename}\n`;
		if (this.author) {
			newAudioNoteText += `author: ${this.author}\n`;
		}
		newAudioNoteText += `---\n`;
		newAudioNoteText += `${newQuote}`;
		return newAudioNoteText;
	}

	get needsToBeUpdated(): boolean {
		if (!this.quote) {
			return true;
		} else {
			return false;
		}
	}

	/* Returns the title of the Audio Note for display in the quote */
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

export class AudioNoteWithPositionInfo extends AudioNote {
	constructor(
		public title: string | undefined,
		public author: string | undefined,
		public audioFilename: string,
		_start: number,
		_end: number,
		_speed: number,
		public transcriptFilename: string | undefined,
		public quoteCreatedForStart: number | undefined,
		public quoteCreatedForEnd: number | undefined,
		public quote: string | undefined,
		public extendAudio: boolean,
		public startLineNumber: number,
		public endLineNumber: number,
		public endChNumber: number,
	) { super(title, author, audioFilename, _start, _end, _speed, transcriptFilename, quoteCreatedForStart, quoteCreatedForEnd, quote, extendAudio); }

	static fromAudioNote(audioNote: AudioNote, startLineNumber: number, endLineNumber: number, endChNumber: number): AudioNoteWithPositionInfo {
		return new AudioNoteWithPositionInfo(
			audioNote.title,
			audioNote.author,
			audioNote.audioFilename,
			audioNote.start,
			audioNote.end,
			audioNote.speed,
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


/**
 * Cache for `audio` HTML elements. The cache has a max size to prevent a significant memory leak.
 * The cache is necessary because in the Live Preview mode, there can be multiple renders of the same
 * audio file, and each of those renders needs to be updated.
 * The alternative would be to scan the existing DOMs (all modes) manually for any players with the
 * same source, and identify the multiple players this way. This way is more computationally expensive,
 * so I've gone with the solution that requires (slightly) more memory (although in practice it likely
 * requires even less memory because it doesn't need to constantly scan the DOMs).
 */
export class AudioElementCache {
	private cache: DefaultMap<string, [HTMLElement, number][]>;
	public count: number;

	constructor(
		public maxSize: number,
	) {
		this.cache = new DefaultMap(() => []);
		this.count = 0;
	}

	public clear(): void {
		this.cache.clear();
		this.count = 0;
	}

	public add(el: HTMLElement): void {
		// Make sure the el contains an audio object.
		const audio = (el.find("audio")! as HTMLMediaElement);
		if (!audio) {
			return;
		}
		const id = getAudioPlayerIdentify(el);
		// Make sure the element doesn't already exist
		for (const [src, pairs] of this.cache) {
			for (const [audioPlayerContainer, ts] of pairs) {
				if (getAudioPlayerIdentify(audioPlayerContainer) === id) {
					return;
				}
			}
		}
		if (this.count >= this.maxSize) {
			this.removeOldest();
		}
		const now = new Date();
		this.cache.get(audio.src).push([el, now.getTime()]);
		this.count += 1;
	}

	public getAudioContainersWithTheSameSrc(id: string): HTMLElement[] {
		let audioPlayerContainer: HTMLElement | undefined = undefined;
		for (const [src, pairs] of this.cache) {
			for (const [_audioPlayerContainer, ts] of pairs) {
				if (getAudioPlayerIdentify(_audioPlayerContainer) === id) {
					audioPlayerContainer = _audioPlayerContainer;
				}
			}
		}
		if (audioPlayerContainer) {
			const audio = (audioPlayerContainer.find("audio")! as HTMLMediaElement);
			if (audio) {
				const src = audio.src;
				return this.cache.get(src).map((pair: [HTMLElement, number]) => pair[0]);
			}
		}
		return [];
	}

	public entries(): [string, HTMLElement[]][] {
		return Array.from(this.cache.entries()).map(([id, pairs]: [string, [HTMLElement, number][]]) => [id, pairs.map(pair => pair[0])]);
	}

	private removeOldest(): void {
		// Find the oldest timestamp
		let oldest: number = Number.MAX_SAFE_INTEGER;
		for (const [id, pairs] of this.cache.entries()) {
			for (const pair of pairs) {
				const [el, ts] = pair;
				if (ts < oldest) {
					oldest = ts;
				}
			}
		}
		// Remove the oldest timestamp
		for (const [id, pairs] of this.cache.entries()) {
			const filteredPairs = pairs.filter((pair: [HTMLElement, number]) => pair[1] > oldest);
			if (pairs.length !== filteredPairs.length) {
				this.cache.set(id, filteredPairs);
				this.count -= (pairs.length - filteredPairs.length); // Subtract the size difference of the arrays, which is the number of elements removed.
			}
		}
	}
}
