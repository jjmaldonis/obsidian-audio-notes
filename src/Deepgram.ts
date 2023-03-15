export interface DeepgramTranscriptionResponse {
    metadata: {
        transaction_key: string,
        request_id: string,
        sha256: string,
        created: string,
        duration: number,
        channels: number,
        models: [
            string
        ],
    },
    results: {
        channels: [
            {
                search: [
                    {
                        query: string,
                        hits: [
                            {
                                confidence: number,
                                start: number,
                                end: number,
                                snippet: string
                            }
                        ]
                    }
                ],
                alternatives: [
                    DeepgramAlternative
                ]
            }
        ]
    }
}


export interface DeepgramAlternative {
    transcript: string,
    confidence: number,
    words: [
        {
            word: string,
            start: number,
            end: number,
            confidence: number,
            punctuated_word: string
        }
    ]
}