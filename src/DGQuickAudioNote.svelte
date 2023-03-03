<script lang="ts">
	import { Mic, Pause, Square, Info } from "lucide-svelte";
	import { deepgramPrerecorded } from "./DeepgramPrerecorded";
	import { Modal, Notice } from "obsidian";
	import PoweredBy from "./PoweredBy.svelte";
	import type AutomaticAudioNotes from "./main";
	export let plugin: AutomaticAudioNotes;
	export let transcript: string | undefined;
	export let audioSaveLocation = "";
	export let noteTitle: string;
	export let chunks: any = [];
	export let audioTagUrl: string;
	export let blobdata: ArrayBuffer;
	export let mainblob: Blob;
	export let recorder: MediaRecorder | undefined;
	export let gumStream: MediaStream | undefined;
	export let extension: any;
	export let saveButtonState: boolean = false;
	export let saveButtonText: string = "Click Record to start Recording";
	export let modal: Modal;
	if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
		extension = "webm";
	} else {
		extension = "ogg";
	}
	export let settings = {
		language: "en-US",
		modelTier: "base",
		punctuation: true,
		numbers: true,
		profanity: true,
		keywords: "",
	};
	export let recordingState = "not-started";
	function startRecording() {
		recordingState = "recording";
		saveButtonText = "Click Stop to stop Recording";
		const constraints = { audio: true };
		navigator.mediaDevices
			.getUserMedia(constraints)
			.then(function (stream) {
				console.info(
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

				/*
					  Create the MediaRecorder object
				  */
				recorder = new MediaRecorder(stream, options);

				//when data becomes available add it to our array of audio data
				recorder.ondataavailable = function (e: any) {
					// add stream data to chunks
					chunks.push(e.data);
					// if recorder is 'inactive' then recording has finished
					if (recorder!.state == "inactive") {
						// convert stream data chunks to a 'webm' audio format as a blob
						mainblob = new Blob(chunks, {
							type: "audio/" + extension,
							bitsPerSecond: 128000,
						} as any);
						getDownloadedFile(mainblob);
					}
				};

				recorder.onerror = function (e: any) {
					console.error(`Could not record audio: ${e.error}`);
				};

				//start recording using 1 second chunks
				//Chrome and Firefox will record one long chunk if you do not specify the chunck length
				recorder.start(1000);
			})
			.catch(function (err) {
				console.error("getUserMedia() failed: " + err);
				//enable the record button if getUserMedia() fails
				// startRecord.disabled = false;
				// stopRecord.disabled = true;
				// pauseRecord.disabled = true;
			});
	}
	async function saveTranscription() {
		let now = new Date().toISOString().replace(/:/g, "-");

		let recording_filename = `AudioNote-${now}.${extension}`;
		audioTagUrl = URL.createObjectURL(mainblob);
		let folder = "";
		try {
			folder = audioSaveLocation === "" ? "/audio" : audioSaveLocation;
			await plugin.app.vault.createFolder(folder);
		} catch (err) {
			console.info("Folder exists. Skipping creation.");
		}
		const file = await plugin.app.vault.createBinary(
			`${folder}/${recording_filename}`,
			blobdata
		);
		await navigator.clipboard.writeText(`![[${recording_filename}]]`);
		new Notice(`${recording_filename} saved ! Link copied to clipboard`);
		modal.close();
		const mdString = makeTranscriptBlock(
			transcript || "",
			`${folder}/${recording_filename}`,
			noteTitle || `Audio Note - ${now}`
		);
		console.log({ mdString });

		let editor = plugin.app.workspace.activeEditor?.editor;
		editor?.replaceSelection(mdString);
	}
	function makeTranscriptBlock(
		transcript: string,
		audioSrc: string,
		noteTitle: string
	) {
		const str = `\`\`\`dg-audio-note \ntitle: ${noteTitle}\naudioSrc: ${audioSrc}\ntranscript: ${transcript}\n\`\`\``;
		return str;
	}
	async function getDownloadedFile(blob: any) {
		blobdata = await blob.arrayBuffer();
		await getTranscription(
			blobdata,
			// get options from state
			{
				language: settings.language,
				tier: settings.modelTier,
				punctuate: settings.punctuation,
				numbers: settings.numbers,
				profanity_filter: settings.profanity,
				keywords: settings.keywords
					.split(",")
					.map((keyword: string) => keyword.trim()),
			}
		);
	}
	function pauseRecording() {
		if (recorder!.state == "recording") {
			//pause
			recorder!.pause();
			recordingState = "paused";
		} else if (recorder!.state == "paused") {
			//resume
			recorder!.resume();
			recordingState = "recording";
		}
	}
	function stopRecording() {
		recordingState = "stopped";
		saveButtonText = "Getting Transcript from Deepgram";
		//tell the recorder to stop the recording
		recorder!.stop();

		//stop microphone access
		gumStream!.getAudioTracks()[0].stop();
	}
	async function getTranscription(
		buffer: Buffer | ArrayBuffer,
		options: any
	) {
		let optionsWithValue = Object.keys(options).filter(function (x) {
			// @ts-ignore
			return options[x] !== false && options[x] !== "";
		});
		let optionsToPass = {};
		optionsWithValue.forEach((key) => {
			// @ts-ignore
			optionsToPass[key] = options[key];
		});
		try {
			console.log("requesting dg");

			const dgResponse = await deepgramPrerecorded(
				plugin.settings.DGApiKey,
				{
					buffer: buffer,
					mimetype: "audio/webm",
				},
				// @ts-ignore
				optionsToPass
			);
			console.log("dgResponse", dgResponse);
			transcript =
				dgResponse?.results?.channels[0].alternatives[0].transcript;
			console.log("transcript", transcript);
			saveButtonState = true;
			saveButtonText = "Save Note with Transcription";
		} catch (err) {
			console.error(err);
			new Notice(`Error getting transcription: ${err.message}`);
			saveButtonState = false;
			saveButtonText =
				"Error getting transcription. Please try again, or see developer console for errors when reporting.";
		}
	}
</script>

<div class="number">
	<div class="header-container">
		<h2>Quick Audio Note</h2>
		<!-- <img src="/DG-powered-by-logo.svg" alt="Powered By Deepgram" /> -->
		<div class="powered-by">
			<PoweredBy />
		</div>
	</div>
	<div class="main-container">
		<div class="left">
			<div class="save-location">
				<label for="audioSaveLocation"
					><p>Save Note In:</p>
					<span>Default is /audio</span>
				</label>

				<input
					type="text"
					id="audioSaveLocation"
					bind:value={audioSaveLocation}
					placeholder="Ex: folder/subfolder"
				/>
			</div>

			<div class="settings">
				<h6>Transcription Settings:</h6>
				<section>
					<div class="setting-row">
						<label for="language"
							><a
								href="https://developers.deepgram.com/documentation/features/language/"
								>Language</a
							>
							<span
								class="info"
								title="Select which language you'll be speaking in"
								><Info /></span
							>
						</label>
						<select bind:value={settings.language} id="language">
							<option value="en">English</option>
							<option value="en-US">English-US</option>
							<option value="en-GB">English-GB</option>
							<option value="en-AU">English-AU</option>
							<option value="en-IN">English-IN</option>
							<option value="en-NZ">English-NZ</option>
							<option value="es">Spanish</option>
							<option value="es-419">Spanish-Latin America</option
							>
							<option value="fr">French</option>
							<option value="fr-CA">French-CA</option>
							<option value="de">German</option>
							<option value="hi">Hindi</option>
							<option value="pt">Portuguese</option>
							<option value="pt-BR">Portuguese-BR</option>
							<option value="pt-PT">Portuguese-PT</option>
							<option value="ru">Russian</option>
							<option value="tr">Turkish</option>
						</select>
					</div>
					<div class="setting-row">
						<label for="modelTier"
							><a
								href="https://developers.deepgram.com/documentation/features/tier/"
								>Model Tier</a
							><span
								class="info"
								title="Base or Enhanced. Enhanced is more accurate but costs more."
								><Info /></span
							>
						</label>
						<select bind:value={settings.modelTier} id="modelTier">
							<option value="base">Base (~$0.75/hr)</option>
							<option value="enhanced"
								>Enhanced (~$0.87/hr)</option
							>
						</select>
					</div>
					<div class="setting-row">
						<label for="punctuation"
							><a
								href="https://developers.deepgram.com/documentation/features/punctuation/"
								>Punctuation
							</a><span
								class="info"
								title="Capitalize and add punctuation to your transcript."
								><Info /></span
							>
						</label>
						<input
							type="checkbox"
							bind:checked={settings.punctuation}
							id="punctuation"
						/>
					</div>
					<div class="setting-row">
						<label for="numbers"
							><a
								href="https://developers.deepgram.com/documentation/features/numerals/"
								>Numbers</a
							>
							<span
								class="info"
								title="Outputs spoken numbers as digits instead of words."
								><Info /></span
							>
						</label>
						<input
							type="checkbox"
							bind:checked={settings.numbers}
							id="numbers"
						/>
					</div>
					<div class="setting-row">
						<label for="profanity"
							><a
								href="https://developers.deepgram.com/documentation/features/profanity-filter/"
								>Profanity Filter
							</a>
							<span
								class="info"
								title="Filters out profanity from your transcript."
								><Info /></span
							>
						</label>
						<input
							type="checkbox"
							bind:checked={settings.profanity}
							id="profanity"
						/>
					</div>
					<div class="setting-row">
						<label for="keywords"
							><a
								href="https://developers.deepgram.com/documentation/features/keywords/"
								>Keywords</a
							>
							<span
								class="info"
								title="You can select keywords to be 'boosted' or 'suppress' in your transcript. To boost a keyword, add a colon and a positive number after it. To suppress a keyword, add a colon and a negative number after it. Ex: kansas:2, elementary:-10"
								><Info /></span
							>
						</label>
						<input
							type="text"
							bind:value={settings.keywords}
							id="keywords"
							placeholder="Ex: kansas:2, elementary:-10"
						/>
					</div>
				</section>
			</div>
		</div>
		<div class="right">
			<div id="note-title-container">
				<label for="noteTitle">Note Title:</label>
				<input
					type="text"
					id="noteTitle"
					bind:value={noteTitle}
					placeholder="Title of your note"
				/>
			</div>
			<div id="recording-container">
				{#if recordingState === "not-started" || recordingState === "stopped"}
					<button
						disabled={recordingState === "stopped"}
						class="record-button"
						on:click={startRecording}
					>
						<Mic />
					</button>
				{/if}
				{#if recordingState === "recording"}
					<button class="record-button" on:click={pauseRecording}>
						<Pause />
					</button>
				{/if}
				{#if recordingState === "paused"}
					<button class="record-button" on:click={pauseRecording}>
						<Mic />
					</button>
				{/if}

				{#if recordingState === "recording"}
					<button class="record-button" on:click={stopRecording}>
						<Square />
					</button>
				{/if}
				<!-- Add wave to indicate recording is in process -->
				{#if recordingState === "not-started"}
					<p>Click the microphone button to start recording.</p>
				{/if}
				{#if recordingState === "paused"}
					<p>
						Recording paused. Resume recording by clicking the
						microphone.
					</p>
				{/if}
				{#if recordingState === "recording"}
					<p>Recording in progress...</p>
				{/if}
				{#if recordingState === "stopped"}
					<p>Recording finished.</p>
				{/if}
			</div>
			<button
				disabled={recordingState !== "stopped" || !saveButtonState}
				id="save-button"
				on:click={saveTranscription}
			>
				{saveButtonText}
			</button>
		</div>
	</div>
</div>

<style>
	.header-container h2 {
		margin-bottom: 0;
	}

	.powered-by {
		background-color: whitesmoke;
		max-width: 150px;
		margin-top: 5px;
		border-radius: 5px;
	}

	.header-container {
		display: flex;
		flex-direction: column;
	}
	.main-container {
		display: grid;
		grid-template-columns: repeat(1, minmax(0, 1fr));
		column-gap: 10px;
		margin-top: 10px;
	}
	.settings section .setting-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 20px;
		row-gap: 10px;
		margin-top: 10px;
	}
	.right {
		margin-top: 20px;
		display: grid;
		grid-template-columns: minmax(0, 1fr);
	}
	.save-location {
		display: grid;
		grid-template-columns: repeat(1, minmax(0, 1fr));
		column-gap: 10px;
	}
	div#note-title-container {
		display: grid;
		grid-template-columns: repeat(1, minmax(0, 1fr));
		margin-bottom: 10px;
	}
	@media (min-width: 1024px) {
		.main-container {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			column-gap: 10px;
			margin-top: 10px;
		}
		.settings section .setting-row {
			display: grid;
			grid-template-columns: 115px 200px;
			column-gap: 20px;
			row-gap: 10px;
			margin-top: 10px;
		}
		.right {
			margin-top: 0px;
			padding: 0 0.8rem;
			display: grid;
		}
		.save-location {
			display: grid;
			grid-template-columns: 100px 200px;
			column-gap: 10px;
		}
		div#note-title-container {
			display: grid;
			grid-template-columns: 100px 230px;
		}
	}

	.save-location p {
		margin: 0;
	}

	.save-location {
		margin-top: 5px;
	}

	.save-location span {
		font-size: 0.75rem;
		font-style: italic;
	}
	.settings {
		border: 1px solid #7f94ad;
		margin-top: 20px;
		padding: 0.8rem;
	}
	.settings h6 {
		font-weight: normal;
		margin-top: 0;
		margin-bottom: 0;
	}

	.settings section label {
		display: flex;
		align-items: center;
	}

	#note-title-container label {
		margin-top: 5px;
	}

	button.record-button {
		border-radius: 50%;
		padding: 25px 13px;
		background-color: #38edac;
		color: black;
		max-width: 55px;
	}
	#save-button {
		background-color: #38edac;
		color: black;
		border-radius: 5px;
		padding: 10px 20px;
		border: none;
		width: 100%;
	}
	#save-button:disabled,
	.record-button:disabled {
		background-color: #7f94ad;
		cursor: not-allowed;
	}
</style>
