const PNG_CONTENT_TYPE = 'image/png';
const IMAGE_RELATIONSHIP_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const EMU_PER_PIXEL = 9525;

const DRAWING_MAIN_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const DRAWING_PICTURE_NAMESPACE = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

type SignatureAsset = {
    buffer: Buffer;
    widthPx: number;
    heightPx: number;
};

export class DocxSignatureEmbedder {
    private buildWp14Id(seed: number) {
        return seed.toString(16).toUpperCase().padStart(8, '0').slice(-8);
    }

    private ensurePngContentType(contentTypesXml: string) {
        if (/Extension="png"\s+ContentType="image\/png"/i.test(contentTypesXml)) {
            return contentTypesXml;
        }

        return contentTypesXml.replace(
            /<\/Types>/,
            `<Default Extension="png" ContentType="${PNG_CONTENT_TYPE}"/></Types>`
        );
    }

    private nextRelationshipId(documentRelsXml: string) {
        const existingIds = Array.from(documentRelsXml.matchAll(/Id="rId(\d+)"/g)).map((match) => Number(match[1]));
        const nextId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

        return `rId${nextId}`;
    }

    private appendRelationship(documentRelsXml: string, relationshipId: string, target: string) {
        return documentRelsXml.replace(
            /<\/Relationships>/,
            `<Relationship Id="${relationshipId}" Type="${IMAGE_RELATIONSHIP_TYPE}" Target="${target}"/></Relationships>`
        );
    }

    private buildDrawingXml(relationshipId: string, asset: SignatureAsset, docPrId: number) {
        const widthEmu = Math.round(asset.widthPx * EMU_PER_PIXEL);
        const heightEmu = Math.round(asset.heightPx * EMU_PER_PIXEL);
        const wp14AnchorId = this.buildWp14Id(docPrId + 17);
        const wp14EditId = this.buildWp14Id(docPrId + 53);

        return [
            '<w:drawing>',
            `<wp:inline distT="0" distB="0" distL="0" distR="0" wp14:anchorId="${wp14AnchorId}" wp14:editId="${wp14EditId}">`,
            `<wp:extent cx="${widthEmu}" cy="${heightEmu}"/>`,
            '<wp:effectExtent l="0" t="0" r="0" b="0"/>',
            `<wp:docPr id="${docPrId}" name="AssinaturaDocente" descr="Assinatura do docente"/>`,
            '<wp:cNvGraphicFramePr/>',
            `<a:graphic xmlns:a="${DRAWING_MAIN_NAMESPACE}">`,
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
            `<pic:pic xmlns:pic="${DRAWING_PICTURE_NAMESPACE}">`,
            '<pic:nvPicPr>',
            `<pic:cNvPr id="${docPrId}" name="AssinaturaDocente.png"/>`,
            '<pic:cNvPicPr preferRelativeResize="0"/>',
            '</pic:nvPicPr>',
            '<pic:blipFill>',
            `<a:blip r:embed="${relationshipId}"/>`,
            '<a:srcRect/>',
            '<a:stretch><a:fillRect/></a:stretch>',
            '</pic:blipFill>',
            '<pic:spPr>',
            `<a:xfrm><a:off x="0" y="0"/><a:ext cx="${widthEmu}" cy="${heightEmu}"/></a:xfrm>`,
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>',
            '<a:ln/>',
            '</pic:spPr>',
            '</pic:pic>',
            '</a:graphicData>',
            '</a:graphic>',
            '</wp:inline>',
            '</w:drawing>',
        ].join('');
    }

    embedSignature(zip: any, paragraphXml: string, approvedBy: string, asset: SignatureAsset) {
        const contentTypesXml = zip.readAsText('[Content_Types].xml');
        const documentRelsPath = 'word/_rels/document.xml.rels';
        const documentRelsXml = zip.readAsText(documentRelsPath);
        const relationshipId = this.nextRelationshipId(documentRelsXml);
        const mediaFileName = `signature-${relationshipId}.png`;
        const paragraphStartTag = paragraphXml.match(/^<w:p\b[^>]*>/)?.[0] || '<w:p>';
        const paragraphProperties = paragraphXml.match(/<w:pPr[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/)?.[0] || '';
        const drawingXml = this.buildDrawingXml(relationshipId, asset, Number(relationshipId.replace('rId', '')) + 1000);
        const updatedParagraphXml = [
            paragraphStartTag,
            paragraphProperties,
            '<w:r><w:rPr><w:noProof/></w:rPr></w:r>',
            `<w:r><w:rPr><w:noProof/></w:rPr><w:t xml:space="preserve">Nome: ${approvedBy} Assinatura: </w:t></w:r>`,
            `<w:r>${drawingXml}</w:r>`,
            '</w:p>',
        ].join('');

        zip.addFile(`word/media/${mediaFileName}`, asset.buffer);
        zip.updateFile('[Content_Types].xml', Buffer.from(this.ensurePngContentType(contentTypesXml), 'utf-8'));
        zip.updateFile(
            documentRelsPath,
            Buffer.from(this.appendRelationship(documentRelsXml, relationshipId, `media/${mediaFileName}`), 'utf-8')
        );

        return updatedParagraphXml;
    }
}