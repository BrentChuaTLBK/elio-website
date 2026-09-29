import { readFile } from 'node:fs/promises';
import { ImageMagick, initializeImageMagick, MagickFormat, MagickReadSettings, ResourceLimits } from '@imagemagick/magick-wasm';
import { HttpError } from './http.ts';

let ready: Promise<void> | undefined;
async function initialize(): Promise<void> {
  if (!ready) ready = (async () => {
    const wasm = await readFile(new URL(import.meta.resolve('@imagemagick/magick-wasm/magick.wasm')));
    await initializeImageMagick(wasm);
    // Browser uploads are resized to at most 3200px. Bound decoder resources too:
    // a small compressed file can otherwise describe an enormous pixel buffer.
    ResourceLimits.width = 8192n;
    ResourceLimits.height = 8192n;
    ResourceLimits.area = 12_000_000n;
    ResourceLimits.memory = 128n * 1024n * 1024n;
    ResourceLimits.disk = 0n;
    ResourceLimits.listLength = 2n;
  })().catch(error => { ready = undefined; throw error; });
  try { await ready; }
  catch { throw new HttpError(503, 'Image validation is temporarily unavailable. Please try again.'); }
}

export async function validatePixels(bytes: Uint8Array, mime: string): Promise<void> {
  await initialize();
  const format = mime === 'image/png' ? MagickFormat.Png : mime === 'image/jpeg' ? MagickFormat.Jpeg : MagickFormat.WebP;
  try {
    ImageMagick.read(bytes, new MagickReadSettings({ format, frameCount: 1 }), image => {
      if (!image.width || !image.height || image.width * image.height > 12_000_000) throw new Error('Image dimensions exceed the upload limit.');
    });
  } catch {
    throw new HttpError(415, 'This image is damaged or too large to read. Choose another PNG, JPEG, or WebP image.');
  }
}
