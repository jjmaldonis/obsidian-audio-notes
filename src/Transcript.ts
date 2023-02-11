import { request } from "obsidian";
import { XMLParser } from 'fast-xml-parser';


export class Transcript {
    constructor(
        public segments: TranscriptSegment[],
    ) { }
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
        return JSON.parse(contents) as Transcript;
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
