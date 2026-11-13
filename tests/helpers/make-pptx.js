// 시험용 PPT를 메모리에서 만든다. 루카 강의 자료를 쓰지 않으려고 직접 조립한다.
// PowerPoint로 열리는 완전한 파일은 아니고, 해석기가 읽는 부분만 실제 구조와 같게 넣는다.
import JSZip from 'jszip';

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const para = (text) => `<a:p><a:r><a:rPr lang="ko-KR"/><a:t>${text}</a:t></a:r></a:p>`;
const shape = (paragraphs, ph = '') =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="x"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paragraphs.map(para).join('')}</p:txBody></p:sp>`;

export function slideXml(paragraphs) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}><p:cSld><p:spTree>${shape(paragraphs)}</p:spTree></p:cSld></p:sld>`;
}

export function notesXml(paragraphs, slideNumber) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:notes ${NS}><p:cSld><p:spTree>`
    + `<p:sp><p:nvSpPr><p:cNvPr id="2" name="img"/><p:cNvSpPr/><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr></p:sp>`
    + shape(paragraphs, '<p:ph type="body" idx="1"/>')
    + `<p:sp><p:nvSpPr><p:cNvPr id="4" name="num"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" sz="quarter" idx="10"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/><a:p><a:fld type="slidenum"><a:t>${slideNumber}</a:t></a:fld></a:p></p:txBody></p:sp>`
    + `</p:spTree></p:cSld></p:notes>`;
}

function relsXml(rels) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + rels.map((r) => `<Relationship Id="${r.id}" Type="${REL}/${r.type}" Target="${r.target}"/>`).join('')
    + `</Relationships>`;
}

/**
 * @param {Array<{ file?: number, paragraphs: string[], notes?: string[], images?: Array<{ name: string, bytes: Uint8Array }> }>} slides
 *   file 은 slideN.xml 의 N. 생략하면 순서대로 1, 2, 3…
 * @param {{ withPresentation?: boolean, order?: number[] }} options
 *   order 는 발표 순서(파일 번호 나열). 생략하면 slides 배열 순서.
 */
export async function makePptx(slides, options = {}) {
  const { withPresentation = true, order } = options;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');

  const fileNumbers = slides.map((s, i) => s.file ?? i + 1);

  slides.forEach((s, i) => {
    const n = fileNumbers[i];
    zip.file(`ppt/slides/slide${n}.xml`, slideXml(s.paragraphs));
    const rels = [];
    if (s.notes) {
      zip.file(`ppt/notesSlides/notesSlide${n}.xml`, notesXml(s.notes, n));
      rels.push({ id: 'rId1', type: 'notesSlide', target: `../notesSlides/notesSlide${n}.xml` });
    }
    (s.images ?? []).forEach((img, k) => {
      zip.file(`ppt/media/${img.name}`, img.bytes);
      rels.push({ id: `rId${k + 2}`, type: 'image', target: `../media/${img.name}` });
    });
    rels.push({ id: 'rId99', type: 'slideLayout', target: '../slideLayouts/slideLayout1.xml' });
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(rels));
  });

  if (withPresentation) {
    const seq = order ?? fileNumbers;
    zip.file('ppt/presentation.xml', `<?xml version="1.0"?><p:presentation ${NS}><p:sldIdLst>${seq.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join('')}</p:sldIdLst></p:presentation>`);
    zip.file('ppt/_rels/presentation.xml.rels', relsXml(fileNumbers.map((n) => ({ id: `rId${n}`, type: 'slide', target: `slides/slide${n}.xml` }))));
  }

  return zip.generateAsync({ type: 'arraybuffer' });
}
