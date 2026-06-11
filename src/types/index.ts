export type TranscriptionSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

export type TranscriptionResponse = {
  text: string;
  language: string;
  segments: TranscriptionSegment[];
};

export enum Routes {
  TRANSCRIBE = "/transcribe",
  CONVERT = "/convert/audio",
  SUMMARIZE = "/summarize",
}
