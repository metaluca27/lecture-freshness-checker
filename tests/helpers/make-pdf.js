// 시험용 PDF를 메모리에서 만든다. 쪽마다 글자 줄 목록을 받는다(영문·숫자만).
// 줄 목록이 비어 있으면 글자가 없는 쪽(스캔한 쪽 흉내)이 된다.

const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * @param {string[][]} pages 쪽마다 글자 줄 목록
 * @returns {Uint8Array}
 */
export function makePdf(pages) {
  const objects = [];
  const add = (body) => { objects.push(body); return objects.length; };

  add('<< /Type /Catalog /Pages 2 0 R >>'); // 1
  add(null); // 2: 쪽 목록은 쪽 번호를 안 뒤에 채운다
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'); // 3

  const pageIds = [];
  for (const lines of pages) {
    const ops = lines.length
      ? `BT /F1 20 Tf 72 720 Td ${lines.map((l, i) => `${i ? '0 -30 Td ' : ''}(${esc(l)}) Tj`).join(' ')} ET`
      : '';
    const contentId = add(`<< /Length ${ops.length} >>\nstream\n${ops}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`));
  }
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
