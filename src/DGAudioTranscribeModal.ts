import { Modal, Notice, moment } from "obsidian";
import { Deepgram } from "@deepgram/sdk";
import AutomaticAudioNotes from "./main";
const { clipboard } = require("electron");

export class DGAudioModal extends Modal {
	constructor(private plugin: AutomaticAudioNotes) {
		super(plugin.app);
	}

	onOpen() {
		const { contentEl } = this;
		// const {titlelEl} = this;
		let audio_modal = this;
		let modal_title = contentEl.createEl("h2", {
			text: "DG Audio Recorder",
		});
		let startRecord = contentEl.createEl("button", { text: "Record" });
		// let recordingState = contentEl.createEl("p", {
		// 	text: "Recording : inactive",
		// });
		let titleInput = contentEl.createEl("input", {
			placeholder: "Note title",
			cls: "title-input",
		});
		let buttonContainer = contentEl.createEl("div", {
			cls: "button-container",
		});
		let audio_tag = contentEl.createEl("audio");
		let line_break = contentEl.createEl("br");
		let MainDiv = contentEl.createEl("div", { cls: "modal-main-div" });
		startRecord.addClass("startRecord");
		let pauseRecord = contentEl.createEl("button", { text: "Pause" });
		let stopRecord = contentEl.createEl("button", { text: "Stop" });
		pauseRecord.addClass("pauseRecord");
		stopRecord.addClass("stopRecord");

		MainDiv.appendChild(titleInput);
		MainDiv.appendChild(buttonContainer);
		buttonContainer.appendChild(startRecord);
		buttonContainer.appendChild(pauseRecord);
		buttonContainer.appendChild(stopRecord);
		MainDiv.style.textAlign = "center";
		pauseRecord.setAttribute("disabled", "true"); // désactivé au départ
		stopRecord.setAttribute("disabled", "true"); // désactivé au départ

		URL = window.URL || window.webkitURL;

		let gumStream: any; //stream from getUserMedia()
		let recorder: any; //MediaRecorder object
		let chunks: any = []; //Array of chunks of audio data from the browser
		let extension: any;
		const deepgram = new Deepgram(this.plugin.settings.DGApiKey);

		if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
			extension = "webm";
		} else {
			extension = "ogg";
		}

		startRecord.addEventListener("click", startRecording);
		stopRecord.addEventListener("click", stopRecording);
		pauseRecord.addEventListener("click", pauseRecording);

		var save_button = contentEl.createEl("button", { text: "Save" });
		var go_to_file = contentEl.createEl("button", {
			text: "Open Recording File",
		});

		buttonContainer.appendChild(save_button);
		buttonContainer.appendChild(go_to_file);

		save_button.style.display = "none";
		go_to_file.style.display = "none";

		function startRecording() {
			save_button.style.display = "none";
			go_to_file.style.display = "none";
			new Notice("Recording started !");

			/*
				  Simple constraints object, for more advanced audio features see
				  https://addpipe.com/blog/audio-constraints-getusermedia/
			  */

			var constraints = { audio: true };

			/*
				  Disable the record button until we get a success or fail from getUserMedia()
			  */

			startRecord.disabled = true;
			stopRecord.disabled = false;
			pauseRecord.disabled = false;

			/*
				  We're using the standard promise based getUserMedia()
				  https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
			  */

			navigator.mediaDevices
				.getUserMedia(constraints)
				.then(function (stream) {
					console.log(
						"getUserMedia() success, stream created, initializing MediaRecorder"
					);

					/*  assign to gumStream for later use  */
					gumStream = stream;

					var options = {
						audioBitsPerSecond: 256000,
						videoBitsPerSecond: 2500000,
						bitsPerSecond: 2628000,
						mimeType: "audio/" + extension + ";codecs=opus",
					};

					//update the format
					// document.getElementById("formats").innerHTML =
					//   "Sample rate: 48kHz, MIME: audio/" + extension + ";codecs=opus";

					/*
					  Create the MediaRecorder object
				  */
					recorder = new MediaRecorder(stream, options);

					//when data becomes available add it to our array of audio data
					recorder.ondataavailable = function (e: any) {
						console.log("recorder.ondataavailable:" + e.data);

						console.log(
							"recorder.audioBitsPerSecond:" +
								recorder.audioBitsPerSecond
						);
						// console.log("recorder.bitsPerSecond:" + recorder.bitsPerSecond);
						// add stream data to chunks
						chunks.push(e.data);
						// if recorder is 'inactive' then recording has finished
						if (recorder.state == "inactive") {
							// convert stream data chunks to a 'webm' audio format as a blob
							var blob = new Blob(chunks, {
								type: "audio/" + extension,
								bitsPerSecond: 128000,
							});
							createDownloadLink(blob, deepgram);
						}
					};

					recorder.onerror = function (e: any) {
						console.log(e.error);
					};

					//start recording using 1 second chunks
					//Chrome and Firefox will record one long chunk if you do not specify the chunck length
					recorder.start(1000);

					//recorder.start();
					//   recorder = null;
					//   blob = null;
					chunks = [];
				})
				.catch(function (err) {
					//enable the record button if getUserMedia() fails
					startRecord.disabled = false;
					stopRecord.disabled = true;
					pauseRecord.disabled = true;
				});
		}
		function pauseRecording() {
			console.log("pauseButton clicked recorder.state=", recorder.state);
			if (recorder.state == "recording") {
				//pause
				recorder.pause();
				pauseRecord.innerHTML = "Resume";
			} else if (recorder.state == "paused") {
				//resume
				recorder.resume();
				pauseRecord.innerHTML = "Pause";
			}
		}
		function stopRecording() {
			console.log("stopButton clicked");

			//disable the stop button, enable the record too allow for new recordings
			stopRecord.disabled = true;
			startRecord.disabled = false;
			pauseRecord.disabled = true;

			//reset button just in case the recording is stopped while paused
			pauseRecord.innerHTML = "Pause";

			//tell the recorder to stop the recording
			recorder.stop();

			//stop microphone access
			gumStream.getAudioTracks()[0].stop();
		}
		function makeTranscriptBlock(
			transcript: string,
			audioSrc: string,
			title: string
		) {
			const str = `\`\`\`dg-audio-note \ntitle: ${title}\naudioSrc: ${audioSrc}\ntranscript: ${transcript}\n\`\`\``;
			console.log("BLOCK STR", str);
			return str;
		}
		async function createDownloadLink(blob: any, deepgram: Deepgram) {
			const blobdata = await blob.arrayBuffer();
			const buffer = Buffer.from(blobdata);
			const dgResponse = await deepgram.transcription.preRecorded(
				{
					buffer: buffer,
					mimetype: "audio/webm",
				},
				{
					punctuate: true,
					times: false,
				}
			);
			const transcript =
				dgResponse?.results?.channels[0].alternatives[0].transcript;
			console.log("transcript", transcript);
			save_button.style.display = "inline";
			var now = moment().format("YYYYMMwebmDDHHmmss");
			var recording_filename = `Recording-${now}.${extension}`;
			var url = URL.createObjectURL(blob);
			// var bau_audio_file: any;
			// var audio_tfile: any;
			save_button.addEventListener("click", async () => {
				// blob.arrayBuffer().then(async (data: any) => {
				console.log(blobdata);
				const folders = app.vault.getAllLoadedFiles();
				console.log({ folders });
				try {
					await app.vault.createFolder("/audio");
				} catch (err) {
					console.log("Folder exists. Skipping creation.");
				}
				await app.vault.createBinary(
					`/audio/${recording_filename}`,
					blobdata
				);
				// 	.then((data_tfile) => {
				// 		bau_audio_file = data_tfile;
				// 	});
				new Notice(
					`${recording_filename} saved ! Link copied to clipboard`
				);
				clipboard.writeText(`![[${recording_filename}]]`);
				// });
				audio_modal.close();
				const mdString = makeTranscriptBlock(
					transcript || "",
					`/audio/${recording_filename}`,
					titleInput.value
				);

				let editor = app.workspace.activeEditor?.editor;
				editor?.replaceSelection(mdString);
			});

			audio_tag.setAttribute("controls", "true");
			audio_tag.setAttribute("src", url);
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
