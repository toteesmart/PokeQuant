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
};

export async function recognizeTextFromImage(uri: string): Promise<OcrResult> {
  console.log('OCR: start', uri);
  const result: TextRecognitionResult = await recognizeText(uri, {
    languages: ['en'],
    recognitionLevel: 'word',
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
