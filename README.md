# Obsidian Audio Notes

## Overview

<strong>Audio Notes</strong> is a plugin for the note-taking app Obsidian. It helps you create notes for audio files.

Here an example:
![](assets/renderedNote.png)

Audio notes have a title, the quote in the audio, and an audio player to replay the audio.

Audio notes can be created using an [Admonition](https://github.com/valentine195/obsidian-admonition)-like code block:
![](assets/unrenderedNote.png)

The following information can be set:
```audio-note
audio: ...
title: ...
transcript: ...
author: ...
---
<your quote>
```

* `audio`: (required) The audio filename. It can be a local file or a link to an audio file online.
  * You can add `#t=<start>,<end>` to the end of the filename to set the start and end time of the quote. For example, you can add `t=1:20,130`. If you do not want to set an end time, you can simply use `t=1:20`.
* `title`: (optional) The title of your note.
* `transcript`: (optional) The filename of the transcript. See below for details.
* `author`: (optional) The text to be used as the author of the quote.

### The Admonition Plugin is Required for Styling

In order to apply the property styling, you must also have the [Admonition](https://github.com/valentine195/obsidian-admonition) plugin installed.

## Generating Quotes using Automatically

<strong>Audio Notes</strong> can automatically insert the text in the audio if a transcript for the audio is available (see [Generating a Transcript](#generating-a-transcript) below).

If you run the command (Ctrl+P) `Generate Audio Notes`, the plugin will find the relevant text in the transcript and automatically insert the text in the note.

The `audio-note` code block will not be overwritten if a quote for the note already exists. This allows you to update the quote's text/formatting without it being overwritten. If you want the quote to be overwritten, delete it before running `Generate Audio Notes`.

![](assets/example.gif)

You can add an exclamation point `!` to the end of the `audio` filename (after `#t=<start>,<end>`) to automatically adjust the start and end times of the audio to match the generated quote. This can be useful if you don't know the exact start and end times.
## Generating a Transcript

If you have an audio file on your computer, you can use [OpenAI Whisper](https://github.com/openai/whisper) to generate a transcript. At the time of writing this plugin, OpenAI Whisper is the state-of-the-art speech recognition library.

You can easily run OpenAI Whisper using Python 3.9. First install Python 3.9 (I recommend using [miniconda](https://docs.conda.io/en/latest/miniconda.html)), then install OpenAI Whipser with `pip install git+https://github.com/openai/whisper.git`.

The following python script will perform speech recognition on your audio file and save the transcript to your vault. Once the transript is in your vault, the Audio Notes plugin can use it to generate text automatically.

```
import whisper
import json


# If tkinter is installed (`pip install tkinter`), show a "Select File" dialog.
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
