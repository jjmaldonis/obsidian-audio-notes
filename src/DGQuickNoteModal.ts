import { Modal, Notice } from "obsidian";
import DGQuickAudioNote from "./DGQuickAudioNote.svelte";
import type AutomaticAudioNotes from "./main";

export class DGQuickNoteModal extends Modal {
	component: DGQuickAudioNote;

	constructor(private plugin: AutomaticAudioNotes) {
		super(plugin.app);
		this.plugin = plugin;
	}

	async onOpen() {
		this.modalEl.addClass("dg-quick-note-modal");

		this.component = new DGQuickAudioNote({
			target: this.contentEl,
			props: {
				// @ts-ignore
				plugin: this.plugin,
				transcript: undefined,
				audioSaveLocation: undefined,
				noteTitle: "",
				audioTagUrl: "",
				blobdata: new ArrayBuffer(0),
				mainblob: new Blob(),
				recorder: undefined,
				gumStream: undefined,
				extension: undefined,
			},
		});
	}

	async onClose() {
		this.component.$destroy();
	}
}
