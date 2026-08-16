import AdmZip from 'adm-zip';

import { DocxSignatureEmbedder } from '../services/export/DocxSignatureEmbedder';

describe('DocxSignatureEmbedder', () => {
    it('should append signature image assets and relationships to docx package', () => {
        const zip = new AdmZip();
        zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'));
        zip.addFile('word/_rels/document.xml.rels', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>'));

        const embedder = new DocxSignatureEmbedder();
        const paragraphXml = '<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>placeholder</w:t></w:r></w:p>';
        const updatedParagraph = embedder.embedSignature(zip, paragraphXml, 'Prof. Teste', {
            buffer: Buffer.from('png-binary'),
            widthPx: 320,
            heightPx: 80,
        });

        expect(updatedParagraph.indexOf('<w:drawing>')).toBeLessThan(updatedParagraph.indexOf('Nome: Prof. Teste Assinatura:'));
        expect(updatedParagraph).toContain('Nome: Prof. Teste Assinatura: ____________________________________');
        expect(updatedParagraph).toContain('<w:jc w:val="right"/>');
        expect(updatedParagraph).toContain('<w:keepNext/>');
        expect(updatedParagraph).toContain('<w:keepLines/>');
        expect(updatedParagraph).toContain('<w:drawing>');
        const extent = updatedParagraph.match(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/);
        expect(Number(extent?.[1])).toBeLessThanOrEqual(210 * 9525);
        expect(Number(extent?.[2])).toBeLessThanOrEqual(58 * 9525);
        expect(zip.readAsText('[Content_Types].xml')).toContain('Extension="png"');
        expect(zip.readAsText('word/_rels/document.xml.rels')).toContain('relationships/image');
        expect(zip.getEntry('word/media/signature-rId1.png')).toBeTruthy();
    });

    it('should keep paragraph context and emit LibreOffice-friendly drawing markup', () => {
        const zip = new AdmZip();
        zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'));
        zip.addFile(
            'word/_rels/document.xml.rels',
            Buffer.from(
                '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpg"/></Relationships>'
            )
        );

        const embedder = new DocxSignatureEmbedder();
        const paragraphXml =
            '<w:p w14:paraId="AAAA1111" w14:textId="BBBB2222" w:rsidR="00000001"><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>placeholder</w:t></w:r></w:p>';

        const updatedParagraph = embedder.embedSignature(zip, paragraphXml, 'Jamilson', {
            buffer: Buffer.from('png-binary-2'),
            widthPx: 420,
            heightPx: 120,
        });

        expect(updatedParagraph).toContain('<w:p w14:paraId="AAAA1111" w14:textId="BBBB2222" w:rsidR="00000001">');
        expect(updatedParagraph).toContain('<w:jc w:val="both"/>');
        expect(updatedParagraph).toContain('wp14:anchorId="');
        expect(updatedParagraph).toContain('wp14:editId="');
        expect(updatedParagraph).toContain('xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"');
        expect(updatedParagraph).toContain('xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"');
        expect(updatedParagraph).toContain('<a:srcRect/>');
        expect(updatedParagraph).toContain('<a:ln/>');
        expect(updatedParagraph.indexOf('<w:drawing>')).toBeLessThan(updatedParagraph.indexOf('Nome: Jamilson Assinatura:'));
        expect(updatedParagraph).toContain('Nome: Jamilson Assinatura: ____________________________________');
        expect(updatedParagraph).toContain('<w:jc w:val="right"/>');
        expect(updatedParagraph).toContain('r:embed="rId9"');

        const relsXml = zip.readAsText('word/_rels/document.xml.rels');
        expect(relsXml).toContain('Id="rId9"');
        expect(relsXml).toContain('Target="media/signature-rId9.png"');
        expect(zip.getEntry('word/media/signature-rId9.png')).toBeTruthy();
    });
});
