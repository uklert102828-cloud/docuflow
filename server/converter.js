import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';

const A4 = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };

function run(bin, args, { signal, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd, signal, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim().slice(-1000) || `${bin} 退出，代码 ${code}`));
    });
  });
}

function baseName(name) {
  return path.basename(name, path.extname(name)).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 100) || 'document';
}

export async function wordToPdf(input, outputDir, originalName, tools, signal) {
  await run(tools.soffice, ['--headless', '--convert-to', 'pdf', '--outdir', outputDir, input], { signal });
  const generated = path.join(outputDir, `${path.basename(input, path.extname(input))}.pdf`);
  const output = path.join(outputDir, `${crypto.randomUUID()}.pdf`);
  await fs.rename(generated, output);
  return { path: output, name: `${baseName(originalName)}.pdf` };
}

export async function pdfToWord(input, outputDir, originalName, tools, signal) {
  const searchable = path.join(outputDir, `${crypto.randomUUID()}-ocr.pdf`);
  try {
    await run(tools.ocrmypdf, ['--skip-text', '--deskew', '--rotate-pages', '-l', 'chi_sim+eng', input, searchable], { signal });
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    await fs.copyFile(input, searchable);
  }
  const output = path.join(outputDir, `${crypto.randomUUID()}.docx`);
  await run(tools.python, ['-m', 'pdf2docx', 'convert', searchable, output], { signal });
  await fs.rm(searchable, { force: true });
  return { path: output, name: `${baseName(originalName)}.docx` };
}

export async function imagesToPdf(inputs, outputDir, settings = {}) {
  const pdf = await PDFDocument.create();
  for (const input of inputs) {
    const image = sharp(input.path).rotate();
    const metadata = await image.metadata();
    const bytes = await image.flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
    const embedded = await pdf.embedJpg(bytes);
    const imageLandscape = (metadata.autoOrient?.width || metadata.width) > (metadata.autoOrient?.height || metadata.height);
    let pageSize;
    if (settings.paper === 'original') {
      const scale = 72 / (metadata.density || 96);
      pageSize = [embedded.width * scale, embedded.height * scale];
    } else {
      const orientation = settings.orientation === 'auto' ? (imageLandscape ? 'landscape' : 'portrait') : settings.orientation;
      pageSize = A4[orientation] || A4.portrait;
    }
    const page = pdf.addPage(pageSize);
    const margin = settings.paper === 'original' ? 0 : 28;
    const scale = Math.min((pageSize[0] - margin * 2) / embedded.width, (pageSize[1] - margin * 2) / embedded.height);
    const width = embedded.width * scale;
    const height = embedded.height * scale;
    page.drawImage(embedded, { x: (pageSize[0] - width) / 2, y: (pageSize[1] - height) / 2, width, height });
  }
  const output = path.join(outputDir, `${crypto.randomUUID()}.pdf`);
  await fs.writeFile(output, await pdf.save());
  return { path: output, name: '图片合集.pdf' };
}
