import { MarkdownPostProcessorContext, TFile } from "obsidian";

export interface BaseAudioNote {
	title: string;
	audioSrc: string;
	transcript: string;
	srtSrc: string;
	vttSrc: string;
}

export function getFullPath(path: string): string | undefined {
	let srcPath: string | undefined = undefined;
	// If the filename is a link, don't look for it in the vault.
	if (path.startsWith("https") || path.startsWith("http")) {
		srcPath = path;
	} else {
		// If the file isn't a link, look for it in the vault and get its full file path.
		const tfile = this.app.vault.getAbstractFileByPath(path);
		if (!tfile) {
			console.error(`DG-Audo: Could not find file: ${path}`);
			return undefined;
		}
		srcPath = this.app.vault.getResourcePath(tfile as TFile);
	}
	return srcPath;
}

export function QuickNotePostProcessor(
	src: string,
	el: HTMLElement,
	ctx?: MarkdownPostProcessorContext,
	showLogo?: boolean
) {
	const noteObj = {} as BaseAudioNote;
	const lines = src.split(/\r?\n/);
	for (let line of lines) {
		const [key, value] = line.split(":");
		// @ts-ignore
		noteObj[key] = value.trim();
	}
	const div = el.createDiv({ cls: "dg-audio-note" });
	const title = div.createDiv({
		cls: "dg-audio-note-title",
		text: noteObj.title,
	});
	// regex to remove the first / if it exists
	const trimmedSrcNoSlash = noteObj.audioSrc.replace(/^\/+/, "");
	const audioSrcPath = getFullPath(trimmedSrcNoSlash);
	const otherAudio = new Audio(audioSrcPath);
	otherAudio.controls = true;
	otherAudio.addClass("dg-audio-note-audio");
	// says controlsList is not a property of HTMLAudioElement but it inherits from HTMLMediaElement which has it
	// @ts-ignore
	otherAudio.controlsList = "nodownload";
	otherAudio.loop = false;
	div.appendChild(otherAudio);
	const poweredBy = div.createEl("a", {
		cls: `dg-audio-note-powered-by ${showLogo ? "" : "hidden"}`,
		href: "https://deepgram.com",
	});
	const logo = poweredBy.createEl("img", {
		cls: "dg-audio-note-logo theme-light",
	});
	logo.src =
		"https://res.cloudinary.com/deepgram/image/upload/v1676406242/blog/DG-powered-by-logo-black-red-horizontal-rgb_wqhltl.svg";

	const transcriptEl = div.createEl("p", {
		cls: "dg-audio-note-transcript",
		text: noteObj.transcript,
	});
	if (noteObj.srtSrc) {
		const srt = div.createEl("a", {
			cls: "dg-audio-note-srt",
			href: this._getFullPath(noteObj.srtSrc || ""),
		});
	}
	if (noteObj.vttSrc) {
		const vtt = div.createEl("a", {
			cls: "dg-audio-note-vtt",
			href: this._getFullPath(noteObj.vttSrc || ""),
		});
	}
	div.appendChild(poweredBy);
}
