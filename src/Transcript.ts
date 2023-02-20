import { Notice, Plugin, request } from "obsidian";
import { XMLParser } from 'fast-xml-parser';
import type { AudioNotesSettings } from "./AudioNotesSettings";


export class Transcript {
    constructor(
        public segments: TranscriptSegment[],
    ) { }

    public getQuote(quoteStart: number, quoteEnd: number): [number, number, string] {
        // Get the relevant part of the transcript.
        const segments = this.segments;
        const result = [];
        let start = undefined;
        let end = undefined;
        for (let segment of segments) {
            const text = segment.text;
            const segmentStart = segment.start;
            const segmentEnd = segment.end;
            // If either the segment's start or end is inside the range specified by the user...
            if ((quoteStart <= segmentStart && segmentStart < quoteEnd) || (quoteStart < segmentEnd && segmentEnd <= quoteEnd)) {
                result.push(text);
                if (start === undefined) {
                    start = segmentStart;
                }
                end = segmentEnd;
            }
            // If the range specified by the user is entirely within the segment...
            if (quoteStart >= segmentStart && quoteEnd <= segmentEnd) {
                result.push(text);
                if (start === undefined) {
                    start = segmentStart;
                }
                end = segmentEnd;
            }
        }
        let quoteText = result.join(" ").trim();
        if (quoteText) {
            // For some reason double spaces are often in the text. Remove them because they get removed by the HTML rendering anyway.
            let i = 0;
            while (quoteText.includes("  ")) {
                quoteText = quoteText.replace(new RegExp("  "), " ");
                // Make sure we don't hit an infinite loop, even though it should be impossible.
                i += 1;
                if (i > 100) {
                    break;
                }
            }
        }
        if (start === undefined || end === undefined) {
            new Notice("Transcript file does not have start or end times for at least one text entry.");
            console.error(segments);
            throw new Error("Transcript file does not have start or end times for at least one text entry.");
        }
        return [start, end, quoteText];
    }

    public getSegmentAt(time: number): [number | undefined, TranscriptSegment | undefined] {
        for (let i = 0; i < this.segments.length; i++) {
            const segment = this.segments[i];
            if (segment.start <= time && time < segment.end) {
                return [i, segment];
            }
        }
        return [undefined, undefined]; // if not found
    }
}


export class TranscriptSegment {
    constructor(
        public id: number | string, // we don't use this. if we do, probably make it a number.
        public start: number, // time in seconds
        public end: number, // time in seconds
        public text: string,
    ) { }
}


export function parseTranscript(contents: string): Transcript {
    // We don't always have a filename (e.g. if the transcript was pulled from online). Assume JSON, and fallback to SRT.
    try {
        return new Transcript(JSON.parse(contents).segments);
    } catch {
        return new SrtParser().fromSrt(contents);
    }
}


export async function getYouTubeTranscript(url: string): Promise<Transcript | undefined> {
    const html: string = await request({
        url: url,
        method: 'GET'
    });

    function unescapeText(s: string): string {
        var re = /&(?:amp|#38|lt|#60|gt|#62|apos|#39|quot|#34);/g;
        var unescaped: Map<string, string> = new Map([
            ['&amp;', '&'],
            ['&#38;', '&'],
            ['&lt;', '<'],
            ['&#60;', '<'],
            ['&gt;', '>'],
            ['&#62;', '>'],
            ['&apos;', "'"],
            ['&#39;', "'"],
            ['&quot;', '"'],
            ['&#34;', '"'],
        ]);
        return s.replace(re, function (m: string): string {
            return unescaped.get(m) || m;
        });
    }

    const captionsMetadata = JSON.parse(html.split(`"captions":`)[1].split(`,"videoDetails`)[0]).playerCaptionsTracklistRenderer.captionTracks;
    for (const capmeta of captionsMetadata) {
        if (capmeta.languageCode === 'en') {
            const xml: string = await request({
                url: capmeta.baseUrl,
                method: 'GET'
            });
            const xmlParser = new XMLParser({ ignoreAttributes: false });
            const parsed = xmlParser.parse(xml).transcript.text;
            let id = 0;
            const segments: TranscriptSegment[] = [];
            for (const line of parsed) {
                const start = parseFloat(line['@_start']);
                const duration = parseFloat(line['@_dur']);
                let text = unescapeText(line['#text']);
                text = text.replace("\n", " ");
                text = text.toLowerCase();
                const sentenceCaseRegex = /(^\w{1}|\.\s*\w{1})/gi;
                text = text.replace(sentenceCaseRegex, function (toReplace: string): string { return toReplace.toUpperCase(); });
                const end = start + duration;
                const segment = new TranscriptSegment(id, start, end, text);
                segments.push(segment);
                id = id + 1;
            }
            const transcript = new Transcript(segments);
            return transcript;
        }
    }
    return undefined;
}


class SrtParser {
    seperator = ",";

    timestampToSeconds(srtTimestamp: string) {
        const [rest, millisecondsString] = srtTimestamp.split(",");
        const milliseconds = parseInt(millisecondsString);
        const [hours, minutes, seconds] = rest.split(":").map((x) => parseInt(x));
        const result = milliseconds * 0.001 + seconds + 60 * minutes + 3600 * hours;

        // fix odd JS roundings, e.g. timestamp '00:01:20,460' result is 80.46000000000001
        return Math.round(result * 1000) / 1000;
    };

    correctFormat(time: string) {
        // Fix the format if the format is wrong
        // 00:00:28.9670 Become 00:00:28,967
        // 00:00:28.967  Become 00:00:28,967
        // 00:00:28.96   Become 00:00:28,960
        // 00:00:28.9    Become 00:00:28,900

        // 00:00:28,96   Become 00:00:28,960
        // 00:00:28,9    Become 00:00:28,900
        // 00:00:28,0    Become 00:00:28,000
        // 00:00:28,01   Become 00:00:28,010
        // 0:00:10,500   Become 00:00:10,500
        let str = time.replace(".", ",");

        var hour = null;
        var minute = null;
        var second = null;
        var millisecond = null;

        // Handle millisecond
        var [front, ms] = str.split(",");
        millisecond = this.fixed_str_digit(3, ms);

        // Handle hour
        var [a_hour, a_minute, a_second] = front.split(":");
        hour = this.fixed_str_digit(2, a_hour, false);
        minute = this.fixed_str_digit(2, a_minute, false);
        second = this.fixed_str_digit(2, a_second, false);

        return `${hour}:${minute}:${second},${millisecond}`;
    }

    /*
    // make sure string is 'how_many_digit' long
    // if str is shorter than how_many_digit, pad with 0
    // if str is longer than how_many_digit, slice from the beginning
    // Example:
    Input: fixed_str_digit(3, '100')
    Output: 100
    Explain: unchanged, because "100" is 3 digit
    Input: fixed_str_digit(3, '50')
    Output: 500
    Explain: pad end with 0
    Input: fixed_str_digit(3, '50', false)
    Output: 050
    Explain: pad start with 0
    Input: fixed_str_digit(3, '7771')
    Output: 777
    Explain: slice from beginning
    */
    private fixed_str_digit(
        how_many_digit: number,
        str: string,
        padEnd: boolean = true
    ) {
        if (str.length == how_many_digit) {
            return str;
        }
        if (str.length > how_many_digit) {
            return str.slice(0, how_many_digit);
        }
        if (str.length < how_many_digit) {
            if (padEnd) {
                return str.padEnd(how_many_digit, "0");
            } else {
                return str.padStart(how_many_digit, "0");
            }
        }
    }

    private tryComma(data: string) {
        data = data.replace(/\r/g, "");
        var regex =
            /(\d+)\n(\d{1,2}:\d{2}:\d{2},\d{1,3}) --> (\d{1,2}:\d{2}:\d{2},\d{1,3})/g;
        let data_array = data.split(regex);
        data_array.shift(); // remove first '' in array
        return data_array;
    }

    private tryDot(data: string) {
        data = data.replace(/\r/g, "");
        var regex =
            /(\d+)\n(\d{1,2}:\d{2}:\d{2}\.\d{1,3}) --> (\d{1,2}:\d{2}:\d{2}\.\d{1,3})/g;
        let data_array = data.split(regex);
        data_array.shift(); // remove first '' in array
        this.seperator = ".";
        return data_array;
    }

    fromSrt(data: string): Transcript {
        var originalData = data;
        var data_array = this.tryComma(originalData);
        if (data_array.length == 0) {
            data_array = this.tryDot(originalData);
        }

        var segments = [];
        for (var i = 0; i < data_array.length; i += 4) {
            const startTime = this.correctFormat(data_array[i + 1].trim());
            const endTime = this.correctFormat(data_array[i + 2].trim());
            let text = data_array[i + 3].trim();
            text = text.replace(/\n/, " ");
            const segment = new TranscriptSegment(
                data_array[i].trim(),
                this.timestampToSeconds(startTime),
                this.timestampToSeconds(endTime),
                text,
            );
            segments.push(segment);
        }

        return new Transcript(segments);
    }
}


export class TranscriptsCache {
    cache: Map<string, Transcript> = new Map();
    constructor(private settings: AudioNotesSettings, private loadFiles: (filenames: string[]) => Promise<Map<string, string>>) { }

    async getTranscript(transcriptFilename: string | undefined): Promise<Transcript | undefined> {
        if (transcriptFilename === undefined) {
            return undefined;
        }

        // Check the cache first.
        if (this.cache.has(transcriptFilename)) {
            return this.cache.get(transcriptFilename);
        }

        let transcriptContents: string | undefined = undefined;
        let transcript: Transcript | undefined = undefined;
        // Check if the transcript is a file.
        if (transcriptFilename.endsWith(".json") || transcriptFilename.endsWith(".srt")) {
            const translationFilesContents = await this.loadFiles([transcriptFilename]);
            transcriptContents = translationFilesContents.get(transcriptFilename);
            if (transcriptContents !== undefined) {
                transcript = parseTranscript(transcriptContents);
            }
        // Check if the transcript is a youtube video's subtitles.
        } else if (transcriptFilename.includes("youtube.com")) {
            const urlParts = transcriptFilename.split("?");
            const urlParams: Map<string, string> = new Map();
            for (const param of urlParts[1].split("&")) {
                const [key, value] = param.split("=");
                urlParams.set(key, value);
            }
            const url = `${urlParts[0]}?v=${urlParams.get("v")}`;
            transcript = await getYouTubeTranscript(url);
        }
        // Check if the transcript can be found online.
        if (transcript === undefined && this.settings.audioNotesApiKey) {
            transcriptContents = await request({
                url: 'https://iszrj6j2vk.execute-api.us-east-1.amazonaws.com/prod/transcriptions',
                method: 'GET',
                headers: {
                    'x-api-key': this.settings.audioNotesApiKey,
                    "url": transcriptFilename,
                },
                contentType: 'application/json',
            });
            if (transcriptContents) {
                transcript = parseTranscript(transcriptContents);
            }
        }

        // Put the result in the cache before returning it.
        if (transcript) {
            this.cache.set(transcriptFilename, transcript);
        }
        return transcript;
    }
}
