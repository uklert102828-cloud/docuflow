import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { imagesToPdf } from '../server/converter.js';

test('image conversion creates one auto-oriented A4 page per image', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'docuflow-image-'));
  t.after(async () => fs.rm(temp, { recursive: true, force: true }));
  const portrait = path.join(temp, 'portrait.png');
  const landscape = path.join(temp, 'landscape.jpg');
  await sharp({ create: { width: 200, height: 300, channels: 3, background: '#137f76' } }).png().toFile(portrait);
  await sharp({ create: { width: 400, height: 200, channels: 3, background: '#171918' } }).jpeg().toFile(landscape);
  const result = await imagesToPdf([{ path: portrait }, { path: landscape }], temp, { paper: 'a4', orientation: 'auto' });
  const pdf = await PDFDocument.load(await fs.readFile(result.path));
  assert.equal(pdf.getPageCount(), 2);
  assert.ok(pdf.getPage(0).getHeight() > pdf.getPage(0).getWidth());
  assert.ok(pdf.getPage(1).getWidth() > pdf.getPage(1).getHeight());
});
