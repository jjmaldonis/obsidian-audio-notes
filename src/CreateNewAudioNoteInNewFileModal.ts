import { FuzzySuggestModal, App, TFile, Notice, MarkdownView } from "obsidian";

export class CreateNewAudioNoteInNewFileModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private mp3Files: TFile[]) {
		super(app);
		// this.setInstructions([{ "command": "Select mp3 file from vault or enter a URL to an mp3 file online", "purpose": "" }]);
		this.setPlaceholder("or select an mp3 file from your vault using the dropdown below:")
	}

	getItems(): TFile[] {
		return this.mp3Files;
	}

	getItemText(file: TFile): string {
		return file.path;
	}

	onOpen(): void {
		super.onOpen();
		const header = createEl("h1", { text: "Create new Audio Note file from mp3", cls: "create-new-audio-note-file-title" })
		const prompt = Array.from(this.containerEl.childNodes)[1];

		const pasteUrlContainer = createDiv({ cls: "create-new-audio-note-file-url-container" });
		const urlInputContainer = pasteUrlContainer.createDiv({ cls: "prompt-input-container create-new-audio-note-file-prompt-input-container" });
		const urlInput = urlInputContainer.createEl("input", { placeholder: `Paste a URL to an online mp3 file...`, cls: "prompt-input create-new-audio-note-file-input-element" })
		const submitUrlButton = pasteUrlContainer.createEl("button", { cls: "mod-cta create-new-audio-note-file-submit-button", text: "Create new note from URL" });
		submitUrlButton.addEventListener('click', () => {
			const url = urlInput.value;
			const urlParts = url.split("/");
			const lastPart = urlParts[urlParts.length - 1];
			const title = lastPart.split("?")[0].replace(/.mp3/g, "");
			const newNoteFilename = title + ".md";
			this.createNewAudioNoteFile(url, newNoteFilename, title);
			this.close();
		});

		const nodes: Node[] = [header, pasteUrlContainer];
		for (const node of Array.from(prompt.childNodes)) {
			nodes.push(node);
		}

		prompt.setChildrenInPlace(nodes);
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
		const newNoteFilename = file.path.split(".").slice(0, file.path.split(".").length - 1).join(".") + ".md"
		let title = file.name;
		title = file.name.slice(0, file.name.length - (file.extension.length + 1));
		title = title.replace(/-/g, " ");
		title = title.replace(/_/g, " ");
		title = title.split(" ").map((part: string) => part.charAt(0).toUpperCase() + part.slice(1, undefined)).join(" ");
		this.createNewAudioNoteFile(file.path, newNoteFilename, title);
	}

	async createNewAudioNoteFile(audioFilename: string, newNoteFilename: string, title: string) {
		let transcriptFilename = audioFilename;
		const testTranscriptFilename = transcriptFilename.split(".").slice(0, transcriptFilename.split(".").length - 1).join(".") + ".json";
		if (await this.app.vault.adapter.exists(testTranscriptFilename)) {
			transcriptFilename = testTranscriptFilename;
		}
		const newNoteContents = `\`\`\`audio-note
audio: ${audioFilename}
transcript: ${transcriptFilename}
title: ${title}
\`\`\`
`;
		const numberOfLines = 5;
		this.app.vault.create(newNoteFilename, newNoteContents).then((newNote: TFile) => {
			// Create the file and open it in the active leaf
			const leaf = this.app.workspace.getLeaf(false);
			leaf.openFile(newNote).then(() => {
				const view = leaf.view;
				if (view && view instanceof MarkdownView) {
					view.editor.setCursor(numberOfLines);
				}
			});
		}).catch((error: any) => {
			new Notice(`Could not create new audio note file: ${newNoteFilename}`);
			new Notice(`${error}`);
		});
	}
}
