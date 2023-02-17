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
				modal: this,
			},
		});
	}

	async onClose() {
		this.component.$destroy();
	}
}
