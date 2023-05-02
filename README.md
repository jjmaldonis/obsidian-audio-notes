![version](https://img.shields.io/badge/version-0.7.2-blue)
![license](https://img.shields.io/badge/license-MIT-brightgreen)
<a href='https://ko-fi.com/jjmaldonis' target='_blank'><img height='20' style='border:0px;height:26px;margin-bottom:-2.5px;' src='https://az743702.vo.msecnd.net/cdn/kofi3.png?v=0' border='0' alt='Buy Me a Coffee :)' /></a>

# Obsidian Audio Notes

<strong>Audio Notes</strong> is a plugin for the note-taking app Obsidian.

## What are Audio Notes?

<strong>Audio Notes</strong> makes it easy to take notes on podcasts and other audio files as you listen to them.

Check it out!

![](assets/audio-notes-example.gif)

An <strong>Audio Note</strong> is a callout that contains the quote from the audio, coupled with an embedded audio player to replay the quote. It look like this:
![](assets/renderedNote.png)

You can use the speech-to-text software described below to generate transcripts for your audio files. Once you have a transcript, <strong>Audio Notes</strong> will automatically generate quotes for your notes!

To create an Audio Note you must specify an audio file, and you may set a few other attributes. All attributes are set using a callout-like code block:
![](assets/unrenderedNote.png)

* `audio`: (required) The audio filename. It can be a local file or a link to an audio file online.
  * (optional) You can add `#t=<start>,<end>` to the end of the filename to set the start and end time of the quote. For example, you can add `t=1:20,1:30` to start the audio segment at 1:20 and end at 1:30. If you do not want to set an end time, you can simply use `t=<start>`.
  * (optional) You can add `&s=<playback-speed>` to the end of the filename, after `#t=<start>,<end>`, to specify the playback rate. If you do not have a start and end time, you can add `#s=<playback-speed>` to the end of the filename. The playback speed defaults to `1.0`.
* `title`: (optional) The title of your note.
* `transcript`: (optional) The filename of the transcript. See below for details.
* `author`: (optional) The text to be used as the author of the quote.
* `liveUpdate: true`: (optional) If you add the `liveUpdate: true` attribute to the codeblock, the quote will automatically update in the codeblock as the audio plays (see below for more info).

## How to Use the Plugin

Find the .mp3 (or .m4a or .m4b) file you want to take notes on and move it into your vault. You may want to generate a transcript file to allow <strong>Audio Notes</strong> to automatically insert the transcript of the audio (see below).

Once your .mp3 file is in your vault, run the command `Create new Audio Note in new file`. After selecting an mp3 file, a new note is created with an Audio Note that looks like this:

    ```audio-note
    audio: assets/276-paul-grahams-essays-part-2-ads.mp3
    title: Founders Podcast, Episode 276 - Paul Graham's Essays Part 2
    transcript: assets/276-paul-grahams-essays-part-2-ads.json
    ```

Now you can start listening.

When you want to take a note on what was said in the audio, pause the player and run the command `Create new Audio Note at current time (+/- 15 seconds)`. A new audio note will be added at the end of the file, based on the current time of the first audio player in the file.

You can edit the newly created audio note to your heart's content! You can change the text and the start/end times of the audio segment. If you extend the audio and need to regenerate the quote to include more words, you can delete the quote then use the command `Regenerate Current Audio Note` or `Regenerate All Audio Notes` to re-create the quote from the start/end times you set.

Now you can listen to your note any time, anywhere :)

### Bind Hotkeys to Control the Audio Player

If you're on your computer, you can use hotkeys to control the currently-playing audio player. Below are the hotkeys I use:

- `Ctrl + Shift + Right Arrow`: Skip forward
- `Ctrl + Shift + Left Arrow`: Skip backward
- `Ctrl + Shift + Up Arrow`: Speed up
- `Ctrl + Shift + Down Arrow`: Slow down
- `Ctrl + Shift + =`: Reset player to start time
- `Ctrl + Shift + Space`: Toggle play/pause
- `Ctrl + Shift + N`: Create new audio note at current time
- `Ctrl + Shift + G`: Regenerate current audio note

### Live Update for Reading

If you like to read as you listen, you can add the `liveUpdate: true` attribute to the codeblock.

When this feature is turned on, the quote in the audio note will automatically update as the audio plays. (note: the subtitles will not change unless the audio is playing.)

## Using on Mobile

(Only tested on Android)

If you listen to podcasts or other audio files on your phone, being able to take notes on your phone is critical.

The workflow below follows the CODE process by [Tiago Forte](https://fortelabs.com/): Capture, Organize, Distill, and Express. You can quickly capture the information you care about and can come back to it later to organize, distill, and express it without losing your train of though on the podcast/audio you're listening to. This helps to avoid the [Doorway effect](https://en.wikipedia.org/wiki/Doorway_effect#:~:text=The%20doorway%20effect%20is%20a,remained%20in%20the%20same%20place.).

This is the best way I've found to take notes:

1. Install Audio Notes on your phone, and pin the `Create new Audio Note ...` command to the top of your commands (using the core plugin `Command palette`).
2. On your computer preload the .mp3 and transcript, and create a new note in your vault with the initial Audio Note.
3. Sync your vault to your phone.
4. Open Obsidian on your phone and go for a walk! Listen to the .mp3 from within Obsidian using the Audio Note codeblock you just created and synced to your phone.
5. Pause the audio when you hear something you want to remember and swipe down to create a new audio note at the end of the Obsidian note. You can add any personal thoughts at this time below the newly-generated note.
6. When you're done, sync your note back to your computer and edit the quotes.
7. Finish the note by highlighting or summarizing the things you most want to remember.

Click below to see a video of using <strong>Audio Notes</strong> on your phone.

[<img src="assets/audio-notes-example-mobile_exported_0.jpg" style="width:200px" target="_blank">](https://audio-notes-public.s3.amazonaws.com/audio-notes-example-mobile.mp4)

## Taking Notes on YouTube Videos

If you're watching a YouTube video with subtitles, you can take notes on it and <strong>Audio Notes</strong> will automatically insert the subtitles into your note.

1. Install the Media Extended plugin.
2. Embed a YouTube video into your note with `![](https://www.youtube.com/watch?v=ji5_MqicxSo)`.
3. Run the command `Media Extended: Open Media from Link` and paste the URL of the YouTube video into the box. Start listening.
4. When you're ready to take a note, run the command `Audio Notes: (Media Extended YouTube Video) Create new Audio Note at current time (+/- 15 seconds)` to create a new Audio Note that includes the subtitles of the YouTube video.
5. You may want to use the `liveUpdate: true` attribute when listening to YouTube videos.

## Quick Voice Messages

Obsidian provides a Core plugin called *Audio Recorder* which allows you to record voice messages directly in Obsidian, but it lacks some features. We've expanded the functionality of *Audio Recorder* to add transcripts of your voice messages in your Obsidian note.

We also added the ability to pause and resume the recording if you get interupted mid-recording.

### Usage

First, you'll need an API Key from [Deepgram AI](https://dpgr.am/obsidian). It does cost money, but it is really affordable. They also give you up to 12,000 minutes of transcription *for free* as part of the trial period, depending on which additional options you select. After you create a Deepgram API key, add it to your Audio Notes plugin settings.

You can then either use the command `Generate quick audio recording with transcription`, or you can click the microphone icon in the side ribbon. This will pop open a modal giving you the options to select for the transcription. (To learn more about each option, visit their respective links in the modal.) After checking the options you want added, you can hit the green microphone button to start the recording.

When you are done recording, hit the stop button. It will take a few seconds for the transcription to be ready, when it is you can hit the "Save" button and the audio and transcription will be added to your document.

## Generating a Transcript

There are three ways to generate a transcript: use Deepgram to generate a transcript from a URL using the <strong>Audio Notes</strong> plugin use an existing .srt file, or generate a transcript yourself.

### Use Deepgram AI to Transcript an Online Audio File

You can use <a href="https://dpgr.am/obsidian">Deepgram AI</a> to transcribe your audio files if they are available online. (Note: we are working on allowing you to transcribe prerecorded audio files that are not online.)

You can use the `Transcribe mp3 file online` command or the `Create new Audio Note in new file` command to transcribe your podcast or audio. The transcript will be saved in JSON format in your vault and can be used for future Audio Notes.

First, you'll need an API Key from [Deepgram AI](https://dpgr.am/obsidian). It does cost money, but it is really affordable. They also give you up to 12,000 minutes of transcription *for free* as part of the trial period, depending on which additional options you select. After you create a Deepgram API key, add it to your Audio Notes plugin settings.

### Use an Existing .srt File

If you already have the transcript in .srt format, you can use it directly by putting the filename in the `transcript: <your .srt file>` attribute.

### Generating a Transcript Yourself

This process can be difficult because installing OpenAI Whisper is difficult, but here's how it works:

You can use OpenAI Whisper to generate a transcript from an audio file on your computer.

Running OpenAI Whisper requires Python 3.9. I recommending installing Python 3.9 using [miniconda](https://docs.conda.io/en/latest/miniconda.html). Once python is installed, install OpenAI Whipser with `pip install git+https://github.com/openai/whisper.git`. You may also need to install `ffmpeg`, which is more difficult. See OpenAI Whisper's documentation for more info.

The following python script will perform speech recognition on your audio file and save the transcript to your vault. Once the transript is in your vault, the Audio Notes plugin can use it to generate text automatically.

You can install `tkinter` using `pip install tkinter` to display a "Select File" dialog rather than setting the filename in the code.

```
import whisper
import json


# If tkinter is installed, show a "Select File" dialog.
try:
    import tkinter as tk
    from tkinter.filedialog import askopenfilename
    root = tk.Tk()
    root.withdraw()
    audio_filename = askopenfilename()
    print(f"You selected: {audio_filename}")
except ImportError:
    audio_filename = r"<path-to-audio-file-in-your-vault>.mp3"


# Set the following information to perform speech recognition:
model_name = "small.en"  # See https://github.com/openai/whisper for other options
start: float = None  # (optional) Set to the # of seconds to start at
end: float = None  # (optional) Set to the # of seconds to end at

# Load the audio file and trim it if desired
audio = whisper.load_audio(audio_filename)
samples_per_second = 16_000
if end is not None:
    audio = audio[:int(end * samples_per_second)]
if start is not None:
    audio = audio[int(start * samples_per_second):]

# Load the model. It may be multiple GBs.
model = whisper.load_model(model_name)

# Generate the transcript. This may take a long time.
result = model.transcribe(audio, verbose=False)

# Save the transript to a .json file with the same name as the audio file.
for segment in result["segments"]:
    del segment["id"]
    del segment["seek"]
    del segment["tokens"]
    del segment["temperature"]
    del segment["avg_logprob"]
    del segment["compression_ratio"]
    del segment["no_speech_prob"]
    if start is not None:
        segment["start"] += start
        segment["end"] += start
output_filename = ".".join(audio_filename.split(".")[:-1]) + ".json"
with open(output_filename, "w") as f:
    json.dump(result, f)

print("Done!")
```
