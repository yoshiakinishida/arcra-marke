'use strict';
const PptxGenJS = require('pptxgenjs');

const COLOR = { main: '1F3A5F', accent: '2E86DE', text: '333333', sub: '666666', bg: 'F4F7FB' };
const FONT = 'Noto Sans JP';

// 提案 JSON から .pptx を作る（Google スライドで開ける形式）
async function buildPptx(proposal, outPath) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 16:9 (13.33 x 7.5 inch)
  pptx.title = proposal.title;

  // 表紙
  const cover = pptx.addSlide();
  cover.background = { color: COLOR.main };
  cover.addShape(pptx.ShapeType.rect, { x: 0.8, y: 3.55, w: 1.2, h: 0.08, fill: { color: COLOR.accent }, line: { color: COLOR.accent } });
  cover.addText(proposal.title, { x: 0.8, y: 1.6, w: 11.7, h: 1.8, fontFace: FONT, fontSize: 36, bold: true, color: 'FFFFFF', valign: 'bottom', fit: 'shrink' });
  if (proposal.subtitle) {
    cover.addText(proposal.subtitle, { x: 0.8, y: 3.85, w: 11.7, h: 0.8, fontFace: FONT, fontSize: 18, color: 'DDE6F0' });
  }

  proposal.slides.forEach((sl, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: 7.5, fill: { color: COLOR.accent }, line: { color: COLOR.accent } });
    slide.addText(sl.title, { x: 0.6, y: 0.35, w: 12.1, h: 0.9, fontFace: FONT, fontSize: 28, bold: true, color: COLOR.main, fit: 'shrink' });
    let y = 1.35;
    if (sl.lead) {
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y, w: 12.1, h: 0.85, fill: { color: COLOR.bg }, line: { color: COLOR.bg } });
      slide.addText(sl.lead, { x: 0.8, y, w: 11.7, h: 0.85, fontFace: FONT, fontSize: 18, bold: true, color: COLOR.accent, valign: 'middle', fit: 'shrink' });
      y += 1.15;
    }
    if (sl.bullets.length) {
      slide.addText(
        sl.bullets.map((b) => ({ text: b, options: { bullet: { indent: 18 }, paraSpaceAfter: 10 } })),
        { x: 0.8, y, w: 11.7, h: 6.8 - y, fontFace: FONT, fontSize: 20, color: COLOR.text, valign: 'top', fit: 'shrink' }
      );
    }
    slide.addText(String(i + 2), { x: 12.2, y: 6.95, w: 0.8, h: 0.4, fontFace: FONT, fontSize: 10, color: COLOR.sub, align: 'right' });
    if (sl.notes) slide.addNotes(sl.notes);
  });

  await pptx.writeFile({ fileName: outPath });
  return outPath;
}

module.exports = { buildPptx };
