import {
  recognizeText,
  type RecognizedTextElement,
  type TextRecognitionResult,
} from '@dariyd/react-native-text-recognition';

export type OcrBlock = {
  text: string;
  confidence: number;
  level: 'word' | 'line' | 'block';
  x: number;
  y: number;
  width: number;
  height: number;
};

export type OcrResult = {
  fullText: string;
  blocks: OcrBlock[];
  topText?: string;
  bottomText?: string;
  numberText?: string | null;
};

// The iOS native module stores the response callback on a shared instance
// property — overlapping calls overwrite it, the last callback fires twice,
// and RN aborts ("illegal callback invocation"). Serialize every call.
let ocrQueue: Promise<unknown> = Promise.resolve();

async function runRecognizeText(
  uri: string,
  recognitionLevel: 'word' | 'line' | 'block'
): Promise<OcrResult> {
  console.log('OCR: start', uri, recognitionLevel);
  const result: TextRecognitionResult = await recognizeText(uri, {
    languages: ['en'],
    recognitionLevel,
    useFastRecognition: false,
  });

  if (!result.success || !result.pages) {
    const message = result.errorMessage ?? 'Unknown OCR error';
    throw new Error(`OCR failed: ${message}`);
  }

  const page = result.pages[0];
  const fullText = result.fullText ?? page.fullText ?? '';

  const blocks: OcrBlock[] = (page.elements ?? [])
    .filter((el: RecognizedTextElement) => el.text?.trim())
    .map((el: RecognizedTextElement) => ({
      text: el.text,
      confidence: el.confidence,
      level: el.level,
      x: el.boundingBox.x,
      y: el.boundingBox.y,
      width: el.boundingBox.width,
      height: el.boundingBox.height,
    }));

  console.log('OCR: done', fullText.length, 'chars,', blocks.length, 'blocks');
  return { fullText, blocks };
}

export function recognizeTextFromImage(
  uri: string,
  recognitionLevel: 'word' | 'line' | 'block' = 'word'
): Promise<OcrResult> {
  const next = ocrQueue.then(() => runRecognizeText(uri, recognitionLevel));
  ocrQueue = next.then(
    () => {},
    () => {}
  );
  return next;
}
