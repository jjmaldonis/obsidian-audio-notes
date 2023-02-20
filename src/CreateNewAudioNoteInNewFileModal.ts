import { FuzzySuggestModal, App, TFile, Notice, MarkdownView, request } from "obsidian";
import type { ApiKeyInfo } from "./AudioNotesSettings";
import { createSelect, Podcast, PodcastEpisode, WHISPER_LANGUAGE_CODES } from "./utils";


export class CreateNewAudioNoteInNewFileModal extends FuzzySuggestModal<TFile> {
	constructor(app: App, private mp3Files: TFile[], private audioNotesApiKey: string, private apiKeyInfo: Promise<ApiKeyInfo | undefined>) {
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

	async onOpen(): Promise<void> {
		super.onOpen();
		const prompt = Array.from(this.containerEl.childNodes)[1];
		const header = createEl("h1", { text: "Create Audio Note in new file", cls: "create-new-audio-note-file-title" })
		const fuzzySelectNodes = [prompt.childNodes[0], prompt.childNodes[1]];

		let transcriptionOptionsContainer: HTMLDivElement | undefined = undefined;
		let submitTranscription: ((url: string) => void) | undefined = undefined;
		let transcribeCheckbox: HTMLInputElement | undefined = undefined;
		// Check if the user has an API key
		const apiKeyInfo = await this.apiKeyInfo;
		if (apiKeyInfo) {
			transcribeCheckbox = createEl("input", { type: "checkbox" });
			transcribeCheckbox.checked = false;

			const baseOrHigher = ["BASE", "SMALL", "MEDIUM", "LARGE"];
			const smallOrHigher = ["SMALL", "MEDIUM", "LARGE"];
			const mediumOrHigher = ["MEDIUM", "LARGE"];
			const largeOrHigher = ["LARGE"];
			const selectModel = createEl("select", {
				cls: "select-model-accuracy"
			});
			const tiny = selectModel.createEl("option");
			tiny.value = "Tiny";
			tiny.textContent = "Tiny";
			if (baseOrHigher.includes(apiKeyInfo.tier)) {
				const base = selectModel.createEl("option");
				base.value = "Base";
				base.textContent = "Base";
				if (smallOrHigher.includes(apiKeyInfo.tier)) {
					const small = selectModel.createEl("option");
					small.value = "Small";
					small.textContent = "Small";
					if (mediumOrHigher.includes(apiKeyInfo.tier)) {
						const medium = selectModel.createEl("option");
						medium.value = "Medium";
						medium.textContent = "Medium";
						if (largeOrHigher.includes(apiKeyInfo.tier)) {
							const large = selectModel.createEl("option");
							large.value = "Large";
							large.textContent = "Large";
						}
					}
				}
			}

			const selectLanguage = createEl("select", {
				cls: "select-model-accuracy"
			});
			for (const langs of WHISPER_LANGUAGE_CODES) {
				const langCode = langs[0];
				const langName = langs[1];
				const option = selectLanguage.createEl("option");
				option.value = langCode;
				option.textContent = langName;
			}

			transcribeCheckbox.onclick = () => {
				selectModel!.disabled = !(transcribeCheckbox!.checked);
				selectLanguage!.disabled = !(transcribeCheckbox!.checked);
			}

			submitTranscription = (url: string) => {
				if (selectModel && selectModel.value && selectLanguage && selectLanguage.value && url && transcribeCheckbox!.checked) {
					const splitUrl = url.split("?");
					const endsWithMp3 = splitUrl[0].endsWith(".mp3") || splitUrl[0].endsWith(".m4b") || splitUrl[0].endsWith(".m4a");
					if (endsWithMp3) {
						// Make the request to enqueue the item
						request({
							url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/queue',
							method: 'POST',
							headers: {
								'x-api-key': this.audioNotesApiKey,
							},
							contentType: 'application/json',
							body: JSON.stringify({
								"url": url,
								"model": selectModel.value.toUpperCase(),
								"language": selectLanguage.value.toLowerCase(),
							})
						}).then((r: any) => {
							new Notice("Successfully queued .mp3 file for transcription");
						}).finally(() => {
							this.close();
						});
					} else {
						new Notice("Make sure your URL is an .mp3, .m4b, or .m4a file. It should end in one of those extensions (excluding everything after an optional question mark).", 10000)
					}
				} else {
					new Notice("Please specify a .mp3 URL, an accuracy level, and a language.")
				}
			}

			transcriptionOptionsContainer = createDiv({ cls: "transcription-options-container-for-new-audio-note" });
			const text = createEl("span");
			text.textContent = "Submit for transcription?";
			transcriptionOptionsContainer.setChildrenInPlace([text, transcribeCheckbox!, selectModel!, selectLanguage!]);
		}

		const fromUrl = async () => {
			const pasteUrlContainer = createDiv({ cls: "create-new-audio-note-file-url-container" });
			const urlInputContainer = pasteUrlContainer.createDiv({ cls: "prompt-input-container create-new-audio-note-file-prompt-input-container" });
			const urlInput = urlInputContainer.createEl("input", { placeholder: `Paste a URL to an online mp3 file...`, cls: "prompt-input create-new-audio-note-file-input-element" })
			const submitUrlButton = pasteUrlContainer.createEl("button", { cls: "mod-cta create-new-audio-note-file-submit-button", text: "Create new note from URL" });

			submitUrlButton.addEventListener('click', () => {
				const url = urlInput.value;
				const urlParts = url.split("/");
				const lastPart = urlParts[urlParts.length - 1];
				let title = lastPart.split("?")[0];
				if (title.includes(".mp3")) {
					title = title.replace(/.mp3/g, "");
				} else if (title.includes(".m4b")) {
					title = title.replace(/.m4b/g, "");
				} else if (title.includes(".m4a")) {
					title = title.replace(/.m4a/g, "");
				}
				const newNoteFilename = (title.replace(/[|&\/\\#,+()$~%'":*?<>{}]/g, "-")) + ".md";
				this.createNewAudioNoteFile(url, newNoteFilename, title);
				if (transcribeCheckbox && transcribeCheckbox.checked && submitTranscription) {
					submitTranscription(url);
				}
				this.close();
			});

			// Set the content for the user to see
			const nodes: Node[] = [header, tab, pasteUrlContainer];
			if (transcriptionOptionsContainer) {
				nodes.push(transcriptionOptionsContainer);
			}
			prompt.setChildrenInPlace(nodes);
		}

		const fromLocalFile = () => {
			const nodes: Node[] = [header, tab, ...fuzzySelectNodes];
			prompt.setChildrenInPlace(nodes);
		}

		const fromPodcast = () => {
			const podcastInputDiv = createDiv({ cls: "podcast-input-div" });
			const podcastInputSpan = podcastInputDiv.createSpan({ text: "Search for a podcast:", cls: "span-podcast-input-text" });
			const podcastSearch = podcastInputDiv.createEl("input", { type: "text", cls: "podcast-search-input" });

			const podcastSelectDiv = createDiv({ cls: "podcast-select-div" });
			const podcastSelectSpan = podcastSelectDiv.createSpan({ text: "Choose a podcast:", cls: "span-podcast-select-text" });
			let podcastResults = podcastSelectDiv.createEl("select", { cls: "select-podcast-results" });
			podcastResults.disabled = true;

			const episodeSelectDiv = createDiv({ cls: "podcast-episode-select-div" });
			const episodeSelectSpan = episodeSelectDiv.createSpan({ text: "Choose an episode:", cls: "span-podcast-episode-select-text" });
			let episodeResults = episodeSelectDiv.createEl("select", { cls: "select-podcast-episode-results" });
			episodeResults.disabled = true;

			let podcastSearchRetrievalTimer: NodeJS.Timeout | undefined = undefined;
			const newGetPodcastsTimer = () => {
				return setTimeout(() => {
					request({
						url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/podcast/search',
						method: 'POST',
						contentType: 'application/json',
						body: JSON.stringify({
							"search": podcastSearch.value,
						})
					}).then((result: string) => {
						const podcasts = JSON.parse(result) as Podcast[];
						const podcastKeys = podcasts.map((p: Podcast) => `${p.name} - ${p.author}`);
						const podcastValues = podcasts.map((p: Podcast) => `{"name": "${p.name}", "author": "${p.author}", "feedUrl": "${p.feedUrl}"}`);
						podcastResults = createSelect(podcastKeys, podcastValues, "select-podcast-results", true);
						podcastSelectDiv.setChildrenInPlace([podcastSelectSpan, podcastResults]);

						podcastResults.onchange = () => {
							request({
								url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/podcast/episode/search',
								method: 'POST',
								contentType: 'application/json',
								body: JSON.stringify({
									"podcast": JSON.parse(podcastResults.value),
								})
							}).then((result2: string) => {
								const episodes = JSON.parse(result2);
								const episodeKeys = episodes.map((e: PodcastEpisode) => e.title);
								const episodeValues = episodes.map((e: PodcastEpisode) => e.url);
								episodeResults = createSelect(episodeKeys, episodeValues, "select-podcast-episode-results", true);
								episodeResults.onchange = () => {
									submitUrlButton.disabled = false;
								}
								episodeSelectDiv.setChildrenInPlace([episodeSelectSpan, episodeResults]);
							});
						}
					})
				}, 1000);
			}
			podcastSearch.oninput = () => {
				if (podcastSearchRetrievalTimer) {
					clearTimeout(podcastSearchRetrievalTimer);
				}
				podcastSearchRetrievalTimer = newGetPodcastsTimer();
			}

			const submitUrlButton = createEl("button", { cls: "mod-cta create-new-audio-note-file-submit-button", text: "Create new note from Podcast" });
			submitUrlButton.disabled = true;
			submitUrlButton.addEventListener('click', () => {
				const url = episodeResults.value;
				const title = episodeResults.options[episodeResults.selectedIndex].text;
				const newNoteFilename = (title.replace(/[|&\/\\#,+()$~%'":*?<>{}]/g, "-")) + ".md";
				this.createNewAudioNoteFile(url, newNoteFilename, title);
				if (transcribeCheckbox && transcribeCheckbox.checked && submitTranscription) {
					submitTranscription(url);
				}
				this.close();
			});

			const nodes: Node[] = [header, tab, podcastInputDiv, podcastSelectDiv, episodeSelectDiv, submitUrlButton];
			if (transcriptionOptionsContainer) {
				nodes.push(transcriptionOptionsContainer);
			}
			prompt.setChildrenInPlace(nodes);
		}

		const tab = createDiv({ cls: "tab" });
		const tab1 = tab.createEl("button", { cls: "tablinks" });
		tab1.onclick = fromLocalFile;
		tab1.textContent = "Local File";
		const tab2 = tab.createEl("button", { cls: "tablinks" });
		tab2.onclick = fromUrl;
		tab2.textContent = "URL";
		const tab3 = tab.createEl("button", { cls: "tablinks" });
		tab3.onclick = fromPodcast;
		tab3.textContent = "Podcast Search";

		fromLocalFile();
	}

	onChooseItem(file: TFile, evt: MouseEvent | KeyboardEvent) {
		const _title = file.path.split(".").slice(0, file.path.split(".").length - 1).join(".");
		const newNoteFilename = (_title.replace(/[|&\/\\#,+()$~%'":*?<>{}]/g, "-")) + ".md";
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
