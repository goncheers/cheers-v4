import express from 'express';
import puppeteer from 'puppeteer';
import bodyParser from 'body-parser';
import { PDFDocument } from 'pdf-lib';
import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path'; // Added for absolute path resolution

const app = express();
const port = process.env.PORT || 3000;

// Middleware to handle JSON content
app.use(bodyParser.json({ limit: '10mb' }));  // For application/json

// Static styles for the table
const staticTableStyles = `
<style>
    html, body {
        margin: 0;
        padding: 0;
        width: 100%;
        height: 100%;
    }
    table {
        width: 100%;
        border-collapse: collapse;
        margin: 0;
        border: 1px solid #ddd;
        page-break-inside: auto; /* Ensure tables are not split across pages */
    }
    th, td {
        border: 1px solid #ddd;
        padding: 12px;
        text-align: left;
        box-sizing: border-box;
        page-break-inside: avoid; /* Ensure table rows are not split across pages */
        vertical-align: top; /* Align cells to the top */
    }
    th:first-child, td:first-child {
        border-left: 1px solid #ddd;
    }
    tr:first-child td {
        border-top: 1px solid #ddd;
    }
    tr:last-child td {
        border-bottom: 1px solid #ddd;
    }
    th {
        background-color: #f8f8f8;
        font-weight: normal;
        color: #333;
        border-bottom: 2px solid #333;
    }
    body {
        padding: 20px;
        box-sizing: border-box;
        margin-right: 40px;
        margin-bottom: 20px;
    }
    /* Reset all borders for the signature section */
    .signature-container, .signature-table, .signature-table tr, .signature-table td, .signature-table th, .signature-table img, .signature-table div {
        border: none !important;
        margin: 0;
        padding: 0;
    }
    .signature-container {
        margin-top: 20px;
        margin-left: 0;
        padding-left: 0;
    }
    .signature-table {
        width: 520px; /* Set table width */
        border-collapse: collapse;
    }
    .signature-table td {
        padding: 5px;
        vertical-align: top;
    }
    .signature-block {
        margin-bottom: 10px;
    }
    .signature-block img {
        width: 200px; /* Make images smaller */
        display: block;
        margin: 0;
    }
    .signature-block p {
        white-space: pre-line; /* Respect \n characters */
    }
    .page-break {
        page-break-before: always;
    }
</style>
`;

const generateSignatureHTML = async (signer) => {
  if (!signer || !signer.image || !signer.text) {
    return '';
  }
  return `
    <div class="signature-block">
      <img src="${signer.image}" alt="${signer.text}">
      <div style="margin-top: 10px;">
        <p>${signer.text}</p>
      </div>
    </div>
  `;
};

const generateSignatureHTML = async (signer) => {
  if (!signer || !signer.image || !signer.text) {
    return '';
  }
  return `
    <div class="signature-block">
      <img src="${signer.image}" alt="${signer.text}">
      <div style="margin-top: 10px;">
        <p>${signer.text}</p>
      </div>
    </div>
  `;
};

const fetchPDFBuffer = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch PDF from ${url}`);
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (err) {
    console.error(`Error fetching PDF from ${url}:`, err);
    throw err;
  }
};

app.post('/generate-pdf', async (req, res) => {
  try {
    if (!req.body.htmlContent) {
      return res.status(400).json({ error: 'htmlContent is missing in the request body' });
    }

    const { 
      htmlContent, 
      signatures = [],
      annexes = [],
      attachments = [],
      type = 'normal',
      offerLetter,
      acceptanceLetter 
    } = req.body;

    console.log('Received type:', type);

    const decodedContent = decodeURIComponent(htmlContent);
    const decodedAnnexes = annexes.map(annex => decodeURIComponent(annex));
    const decodedOfferLetter = offerLetter ? decodeURIComponent(offerLetter) : null;
    const decodedAcceptanceLetter = acceptanceLetter ? decodeURIComponent(acceptanceLetter) : null;

    if (type === 'offer letter' && (!decodedOfferLetter || !decodedAcceptanceLetter)) {
      return res.status(400).json({ error: 'offerLetter and acceptanceLetter are required for "offer letter" type' });
    }

    const companySigners = signatures.filter(s => s.type === 'company');
    const counterpartySigners = signatures.filter(s => s.type === 'counterparty');

    const companySignersHTML = await Promise.all(
      companySigners.map(signer => generateSignatureHTML(signer))
    ).then(results => results.join(''));
    
    const counterpartySignersHTML = await Promise.all(
      counterpartySigners.map(signer => generateSignatureHTML(signer))
    ).then(results => results.join(''));

    const companySignatureSection = `
      <div class="signature-container">
          <table class="signature-table">
              <tr>
                  <td>${companySignersHTML}</td>
                  <td></td>
              </tr>
          </table>
      </div>
    `;

    const counterpartySignatureSection = `
      <div class="signature-container">
          <table class="signature-table">
              <tr>
                  <td></td>
                  <td>${counterpartySignersHTML}</td>
              </tr>
          </table>
      </div>
    `;

    const fullSignatureSection = `
      <div class="signature-container">
          <table class="signature-table">
              <tr>
                  <td>${companySignersHTML}</td>
                  <td>${counterpartySignersHTML}</td>
              </tr>
          </table>
      </div>
    `;

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    const fetchImageAsBase64 = async (url) => {
      try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        return `data:image/png;base64,${buffer.toString('base64')}`;
      } catch (err) {
        console.error(`Failed to fetch image from ${url}:`, err);
        return url;
      }
    };

    const replaceImages = async (content) => {
      let updatedContent = content;
      for (const signer of signatures) {
        if (signer.image && signer.image.startsWith('http')) {
          const base64Image = await fetchImageAsBase64(signer.image);
          updatedContent = updatedContent.replace(signer.image, base64Image);
        }
      }
      return updatedContent;
    };

    const contentWithBase64Images = await replaceImages(decodedContent);
    const offerLetterWithBase64Images = decodedOfferLetter ? await replaceImages(decodedOfferLetter) : null;
    const acceptanceLetterWithBase64Images = decodedAcceptanceLetter ? await replaceImages(decodedAcceptanceLetter) : null;
    const annexesWithBase64Images = await Promise.all(decodedAnnexes.map(annex => replaceImages(annex)));

    let fullContent = `
      <html>
        <head>
          <meta charset="UTF-8">
          ${staticTableStyles}
        </head>
        <body>
    `;

    if (type === 'normal') {
      fullContent += `
        ${contentWithBase64Images}
        ${fullSignatureSection}
      `;
    } else if (type === 'annexes') {
      fullContent += `
        ${contentWithBase64Images}
        ${fullSignatureSection}
      `;
      if (annexesWithBase64Images.length > 0) {
        annexesWithBase64Images.forEach((annexContent) => {
          fullContent += `
            <div class="page-break"></div>
            ${annexContent}
            ${fullSignatureSection}
          `;
        });
      }
    } else if (type === 'offer letter') {
      fullContent += `
        ${offerLetterWithBase64Images}
        ${companySignatureSection}
      `;
      if (annexesWithBase64Images.length > 0) {
        annexesWithBase64Images.forEach((annexContent) => {
          fullContent += `
            <div class="page-break"></div>
            ${annexContent}
          `;
        });
      }
      fullContent += `
        <div class="page-break"></div>
        ${acceptanceLetterWithBase64Images}
        ${counterpartySignatureSection}
      `;
    } else {
      throw new Error(`Invalid type: ${type}. Must be 'normal', 'annexes', or 'offer letter'`);
    }

    fullContent += `
        </body>
      </html>
    `;

    await page.setContent(fullContent, { waitUntil: 'networkidle0' });

    const mainPdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in',
      }
    });

    await browser.close();

    const mergedPdf = await PDFDocument.create();
    
    const mainPdfDoc = await PDFDocument.load(mainPdfBuffer);
    const mainPages = await mergedPdf.copyPages(mainPdfDoc, mainPdfDoc.getPageIndices());
    mainPages.forEach(page => mergedPdf.addPage(page));

    if (attachments.length > 0) {
      for (const attachmentUrl of attachments) {
        try {
          const pdfBuffer = await fetchPDFBuffer(attachmentUrl);
          const attachmentPdf = await PDFDocument.load(pdfBuffer);
          const attachmentPages = await mergedPdf.copyPages(attachmentPdf, attachmentPdf.getPageIndices());
          attachmentPages.forEach(page => mergedPdf.addPage(page));
        } catch (err) {
          console.error(`Failed to process attachment ${attachmentUrl}:`, err);
        }
      }
    }

    const finalPdfBuffer = await mergedPdf.save();

    // Save to disk as debug_final_output.pdf (this works fine)
    const debugFilePath = 'debug_final_output.pdf';
    console.log('Final PDF generated, size:', finalPdfBuffer.length, 'bytes');
    await fs.writeFile(debugFilePath, finalPdfBuffer);
    console.log('Saved final PDF to', debugFilePath);

    // Send the debug_final_output.pdf file directly
    console.log('Sending debug_final_output.pdf as response...');
    res.sendFile(path.resolve(debugFilePath), (err) => {
      if (err) {
        console.error('Error sending file:', err);
        if (!res.headersSent) {
          res.status(500).send('Error sending PDF');
        }
      } else {
        console.log('File sent successfully');
      }
    });

  } catch (err) {
    console.error('Error generating PDF:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'PDF generation failed', message: err.message });
    }
  }
});

app.listen(port, () => {
  console.log(`PDF generation server running at http://localhost:${port}`);
});