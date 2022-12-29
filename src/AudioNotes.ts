import { DefaultMap, secondsToTimeString } from "./utils";


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

	get needsToBeUpdated(): boolean {
		if (!this.quote) {
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
			}
		}
	}
}

