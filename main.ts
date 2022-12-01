import {
	MarkdownView,
	Plugin,
	MarkdownPostProcessorContext,
	MarkdownRenderer,
	MarkdownRenderChild,
	Notice,
} from 'obsidian';
import { IconPrefix } from "@fortawesome/free-regular-svg-icons";
import type { IconName } from "@fortawesome/fontawesome-svg-core";
import {
	findIconDefinition,
	icon as getFAIcon,
} from "@fortawesome/fontawesome-svg-core";


function getIcon(iconName: string) {
	for (const prefix of ["fas", "far", "fab"] as IconPrefix[]) {
		const definition = findIconDefinition({
			iconName: iconName as IconName,
			prefix
		});
		if (definition) return getFAIcon(definition).node[0];
	}
}


class AudioNote {
	constructor(
		public filename: string,
		public start: number,
		public end: number,
		public validationLine: string | undefined,
		public quote: string,
		public extendAudio: boolean,
	) { }

	get needsToBeUpdated(): boolean {
		if (!this.validationLine) {
			return true;
		} else {
			if (this.validationLine.trim().split(" ")[0] === `[${this.start},${this.end}]`) {
				return false;
			} else {
				return true;
			}
		}
	}

	get transcriptFilename(): string {
		const audioExtension = this.filename.split(".")[this.filename.split(".").length - 1];
		const transcriptFilename = this.filename.slice(0, this.filename.length - (audioExtension.length + 1)) + ".transcript";
		return transcriptFilename;
	}
}

class AudioNoteWithPositionInfo extends AudioNote {
	constructor(
		public filename: string,
		public start: number,
		public end: number,
		public validationLine: string | undefined,
		public quote: string,
		public extendAudio: boolean,
		public startLineNumber: number,
		public endLineNumber: number,
		public endChNumber: number,
	) { super(filename, start, end, validationLine, quote, extendAudio); }

	static fromAudioNote(audioNote: AudioNote, startLineNumber: number, endLineNumber: number, endChNumber: number): AudioNoteWithPositionInfo {
		return new AudioNoteWithPositionInfo(
			audioNote.filename,
			audioNote.start,
			audioNote.end,
			audioNote.validationLine,
			audioNote.quote,
			audioNote.extendAudio,
			startLineNumber,
			endLineNumber,
			endChNumber,
		)
	}
}

export default class AutomaticAudioNotes extends Plugin {
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
						this.rerenderAllAudioNotes(markdownView);
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			}
		});

		this.registerMarkdownCodeBlockProcessor(
			`audio-note`,
			(src, el, ctx) => this.postprocessor(src, el, ctx)
		);
	}

	async loadFiles(filenames: string[]): Promise<Map<string, string>> {
		// Load the transcript for the file.
		// Look for the current markdown file at the same time.
		const results = new Map<string, string>();
		const allFiles = this.app.vault.getFiles();
		for (const filename of filenames) {
			for (const f of allFiles) {
				const contents = await this.app.vault.cachedRead(f);
				if (f.path === filename) {
					results.set(filename, contents);
				}
			}
		}
		return results;
	}

	async postprocessor(
		src: string,
		el: HTMLElement,
		ctx?: MarkdownPostProcessorContext
	) {
		// Need this for rendering.
		const currentMdFilename =
			typeof ctx == "string"
				? ctx
				: ctx?.sourcePath ??
				this.app.workspace.getActiveFile()?.path ??
				"";

		const audioNote = this.createAudioNoteFromSrc(src);
		const admonitionType = "quote";
		const theDiv = this.createAudioNoteDiv(audioNote, admonitionType, currentMdFilename, src, ctx);

		// Replace the <pre> tag with the new admonition.
		const parent = el.parentElement;
		if (parent) {
			parent.addClass(
				"admonition-parent",
				`admonition-${admonitionType}-parent`
			);
		}
		el.replaceWith(theDiv);

		return null;
	}

	/* Returns the filename, start time, and end time. If the end time was not set by the user, `Infinity` is returned. */
	getAudioDataFromSrc(src: string): [string, number, number, boolean] {
		const lines = src.split(/\r?\n/);
		let first: string = lines[0];
		const extendAudio = first.endsWith("!");
		if (!src.includes("#")) {
			return [src, 0, Infinity, extendAudio];
		}
		const [filename, timeInfo] = first.split("#");
		const startAndEnd = timeInfo.slice(2, undefined);
		let start = undefined;
		let end = undefined;
		if (startAndEnd.includes(",")) {
			[start, end] = startAndEnd.split(",")
			start = parseFloat(start);
			end = parseFloat(end);
		} else {
			start = parseFloat(startAndEnd);
			end = Infinity;
		}
		return [filename, start, end, extendAudio]
	}

	createAudioNoteDiv(audioNote: AudioNote, admonitionType: string, currentMdFilename: string, src: string, ctx?: MarkdownPostProcessorContext): HTMLElement {
		// Create the audio div.
		const basePath = (this.app.vault.adapter as any).basePath;
		let audioSrcPath = `app://local/${basePath}/${audioNote.filename}#t=${audioNote.start}`;
		if (audioNote.end !== Infinity) {
			audioSrcPath += `,${audioNote.end}`;
		}
		// Below is an alternative way to create the audioDiv. Keep it for documentation.
		// const audioDiv = createEl("audio", {});
		// audioDiv.src = audioSrcPath;
		// audioDiv.controls = true;
		const audioDiv = createEl("audio", { attr: { controls: "", src: audioSrcPath } });
		let markdownRenderChild = new MarkdownRenderChild(audioDiv);
		markdownRenderChild.containerEl = audioDiv;
		if (ctx && !(typeof ctx == "string")) {
			ctx.addChild(markdownRenderChild);
		}

		// Create the quote div.
		const color = "158, 158, 158"; // quote color, pulled from Admonition library
		const admonitionLikeDiv = createDiv({
			cls: `callout admonition admonition-${admonitionType} admonition-plugin ${""
				}`,
			attr: {
				style: color ? `--callout-color: ${color};` : '',
				"data-callout": admonitionType,
				"data-callout-fold": ""
			}
		});
		const titleEl = admonitionLikeDiv.createDiv({
			cls: `callout-title admonition-title ${""
				}`
		});
		const iconEl = titleEl.createDiv(
			"callout-icon admonition-title-icon"
		);
		const icon = getIcon("quote-right");
		if (icon !== undefined) {
			iconEl.appendChild(icon);
		}
		this.renderAdmonitionContent(
			admonitionLikeDiv,
			audioNote.quote,
			ctx,
			currentMdFilename,
			src,
		);

		// Put the divs in a main div and replace the user-created markdown element.
		const theDiv = createDiv();
		theDiv.appendChild(admonitionLikeDiv);
		theDiv.appendChild(audioDiv);
		return theDiv;
	}

	renderAdmonitionContent(
		admonitionElement: HTMLElement,
		content: string,
		ctx: MarkdownPostProcessorContext | undefined,
		sourcePath: string,
		src: string
	) {
		let markdownRenderChild = new MarkdownRenderChild(admonitionElement);
		markdownRenderChild.containerEl = admonitionElement;
		if (ctx && !(typeof ctx == "string")) {
			ctx.addChild(markdownRenderChild);
		}

		if (content && content?.trim().length) {
			/**
			 * Render the content as markdown and append it to the admonition.
			 */

			const contentEl: HTMLDivElement = admonitionElement.createDiv(
				"callout-content admonition-content"
			);
			if (/^`{3,}mermaid/m.test(content)) {
				const wasCollapsed = !admonitionElement.hasAttribute("open");
				if (admonitionElement instanceof HTMLDetailsElement) {
					admonitionElement.setAttribute("open", "open");
				}
				setImmediate(() => {
					MarkdownRenderer.renderMarkdown(
						content,
						contentEl,
						sourcePath,
						markdownRenderChild
					);
					if (
						admonitionElement instanceof HTMLDetailsElement &&
						wasCollapsed
					) {
						admonitionElement.removeAttribute("open");
					}
				});
			} else {
				MarkdownRenderer.renderMarkdown(
					content,
					contentEl,
					sourcePath,
					markdownRenderChild
				);
			}

			const taskLists = contentEl.querySelectorAll<HTMLInputElement>(
				".task-list-item-checkbox"
			);
			if (taskLists?.length) {
				const split = src.split("\n");
				let slicer = 0;
				taskLists.forEach((task) => {
					const line = split
						.slice(slicer)
						.findIndex((l) => /^[ \t>]*\- \[.\]/.test(l));

					if (line == -1) return;
					task.dataset.line = `${line + slicer + 1}`;
					slicer = line + slicer + 1;
				});
			}
		}
	}

	getAudioNoteBlocks(fileContents: string): AudioNoteWithPositionInfo[] {
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
		}

		const allAudioNotes: AudioNoteWithPositionInfo[] = [];
		for (const [startLineNumber, endLineNumber, endChNumber, lines] of allAudioNoteCodeBlockStrings) {
			const audioNote = this.createAudioNoteFromSrc(lines.join("\n"));
			allAudioNotes.push(AudioNoteWithPositionInfo.fromAudioNote(audioNote, startLineNumber, endLineNumber, endChNumber));
		}

		return allAudioNotes;
	}

	createAudioNoteFromSrc(src: string): AudioNote {
		const lines = src.split(/\r?\n/);
		const [filename, start, end, extendAudio] = this.getAudioDataFromSrc(src);
		let validationLine = undefined;
		if (lines.length > 1) {
			validationLine = lines[1];
		} else {
			validationLine = undefined;
		}
		const quote = lines.slice(2, undefined).join("\n").trim();
		const audioNote = new AudioNote(filename, start, end, validationLine, quote, extendAudio);
		return audioNote;
	}

	async rerenderAllAudioNotes(view: MarkdownView) {
		// Load the transcript for the file.
		// Look for the current markdown file at the same time.
		const currentMdFilename = view.file.path;
		const fileContents = await this.loadFiles([currentMdFilename]);
		const currentMdFileContents = fileContents.get(currentMdFilename);
		if (currentMdFileContents === undefined) {
			console.error(`Could not find current .md: ${currentMdFilename}...? This should be impossible.`);
			return undefined;
		}
		const audioNotes: AudioNoteWithPositionInfo[] = this.getAudioNoteBlocks(currentMdFileContents);

		const translationFilenames: string[] = [];
		for (const audioNote of audioNotes) {
			if (audioNote.needsToBeUpdated && !translationFilenames.includes(audioNote.transcriptFilename)) {
				translationFilenames.push(audioNote.transcriptFilename);
			}
		}
		const translationFilesContents = await this.loadFiles(translationFilenames);

		for (const audioNote of audioNotes) {
			if (audioNote.needsToBeUpdated) {
				if (audioNote.quote.includes("`")) {
					new Notice("Before the generation can be run, you must remove any audio notes that have the character ` in their quote.", 10000);
					continue;
				}
				if (audioNote.start >= audioNote.end) {
					new Notice("An audio note has a start time that is after the end time. Fix it!", 10000);
					continue;
				}
				// Get the new quote.
				const transcript = translationFilesContents.get(audioNote.transcriptFilename);
				if (!transcript) {
					console.error(`Could not find transcript: ${audioNote.transcriptFilename}`);
					new Notice(`Could not find transcript: ${audioNote.transcriptFilename}`), 10000;
					continue;
				}
				const [quoteStart, quoteEnd, newQuote] = this.getQuoteFromTranscript(audioNote, transcript);

				// Update the view.editor.
				if (audioNote.startLineNumber === undefined || audioNote.endLineNumber === undefined || audioNote.endChNumber === undefined) {
					console.error(`Could not find line numbers of audio-note...? This should be impossible.`)
					return undefined;
				}
				let start = audioNote.start;
				let end = audioNote.end;
				if (audioNote.extendAudio) {
					start = quoteStart;
					end = quoteEnd;
				}
				const startLine = audioNote.startLineNumber + 1;
				const startCh = 0;
				const endLine = audioNote.endLineNumber - 1;
				const endCh = audioNote.endChNumber;
				const srcStart = { line: startLine, ch: startCh };
				const srcEnd = { line: endLine, ch: endCh };
				const hasChangedLine = `[${start},${end}] - Do not modify`;
				let extra = `\n`;
				extra += `${hasChangedLine}\n`;
				extra += `${newQuote}`;
				let newSrc = `${audioNote.filename}#t=${start}`;
				if (end !== Infinity) {
					newSrc += `,${end}`;
				}
				view.editor.replaceRange(newSrc + extra, srcStart, srcEnd);
			}
		}

		// Tell the user the generation is complete.
		// new Notice('Audio Note generation complete!');
	}

	getQuoteFromTranscript(audioNote: AudioNote, transcriptContents: string): [number, number, string] {
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
			if ((audioNote.start <= segmentStart && segmentStart < audioNote.end) || (audioNote.start < segmentEnd && segmentEnd <= audioNote.end)) {
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

	onunload() { }
}