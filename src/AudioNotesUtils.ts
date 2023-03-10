import { MarkdownView, Notice, TFile, type App } from "obsidian";

export const createNewAudioNoteFile = async (app: App, audioFilename: string, transcriptFilename: string | undefined, newNoteFilename: string, title: string) => {
    if (transcriptFilename === undefined) {
        transcriptFilename = audioFilename;
        const testTranscriptFilename = transcriptFilename.split(".").slice(0, transcriptFilename.split(".").length - 1).join(".") + ".json";
        if (await app.vault.adapter.exists(testTranscriptFilename)) {
            transcriptFilename = testTranscriptFilename;
        }
    }
    const newNoteContents = `\`\`\`audio-note
audio: ${audioFilename}
transcript: ${transcriptFilename}
title: ${title}
\`\`\`
`;
    const numberOfLines = 5;
    app.vault.create(newNoteFilename, newNoteContents).then((newNote: TFile) => {
        // Create the file and open it in the active leaf
        const leaf = app.workspace.getLeaf(false);
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

export const createAudioNoteTitleFromUrl = (url: string): string => {
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
    return title;
}

export const createAudioNoteFilenameFromUrl = (url: string): string => {
    const title = createAudioNoteTitleFromUrl(url);
    const newNoteFilename = (title.replace(/[|&\/\\#,+()$~%'":*?<>{}]/g, "-")) + ".md";
    return newNoteFilename;
}

export const createDeepgramQueryParams = (language: string): any => {
    const DGoptions = {
        language: language,
        modelTier: "base",
        punctuation: true,
        numbers: true,
        profanity: true,
        keywords: "",
    };
    const options = {
        language: DGoptions.language,
        tier: DGoptions.modelTier,
        punctuate: DGoptions.punctuation,
        numbers: DGoptions.numbers,
        profanity_filter: DGoptions.profanity,
        keywords: DGoptions.keywords
            .split(",")
            .map((keyword: string) => keyword.trim()),
    }
    let optionsWithValue = Object.keys(options).filter(function (x) {
        // @ts-ignore
        return options[x] !== false && options[x] !== "";
    });
    let optionsToPass = {};
    optionsWithValue.forEach((key) => {
        // @ts-ignore
        optionsToPass[key] = options[key];
    });
    return optionsToPass;
}
