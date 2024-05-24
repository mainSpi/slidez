/*
if ("serviceWorker" in navigator) {
	window.addEventListener('load', async () => {
		try {
			const reg = await navigator.serviceWorker.register("/sw.js");
			console.log('Service worker registered', reg);
		} catch (err) {
			console.log('Service worker registration failed: ', err);
		}
	});
}
*/

const filePicker = document.getElementById('fileInput');
const colorPicker = document.getElementById('colorInput');
const button = document.getElementById('baixarButton');
const rotateButton = document.getElementById('rotateBtn');
const slider = document.getElementById('blankRange');
const displayCanvas = document.getElementById('the-canvas');
const checkDefaultBackground = document.getElementById('checkDefaultBackground');
const checkAvgColor = document.getElementById('checkAvgColor');
const context = displayCanvas.getContext('2d', {willReadFrequently: true}); // https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
const fac = new FastAverageColor();

let rotation = 0;

let fileBuffer = '';
let fileName = '';

rotateButton.addEventListener('click', () => {
    rotation += 90;
    if (rotation === 360) {
        rotation = 0;
    }
    updatePDF();
});

function updatePDF() {
    drawNewPdf(fileBuffer, true).then(bytes => {
        displayPDF(bytes);
    });
}

function displayPDF(pdfData) {
    let {pdfjsLib} = globalThis;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/pdf.worker.mjs';
    pdfjsLib.getDocument({data: pdfData}).promise.then(function (pdf) {
        pdf.getPage(1).then(function (page) {

            const viewport = page.getViewport({scale: 1});

            // Prepare canvas using PDF page dimensions
            displayCanvas.height = viewport.height;
            displayCanvas.width = viewport.width;

            // Render PDF page into canvas context
            const renderContext = {
                canvasContext: context,
                viewport: viewport
            };
            page.render(renderContext);
        });
    });
}

slider.addEventListener('change', updatePDF);
filePicker.addEventListener('change', () => {
    if (filePicker.files.length === 0){
        return;
    }
    let reader = new FileReader();
    reader.onload = function () {
        fileBuffer = this.result;
        fileName = filePicker.files[0].name;
        updatePDF();
    }
    reader.readAsArrayBuffer(filePicker.files[0]);
});
colorPicker.addEventListener('change', updatePDF);
checkDefaultBackground.addEventListener('change', updatePDF);
checkAvgColor.addEventListener('change', updatePDF);

button.addEventListener('click', function (e) {
    e.preventDefault();
    drawNewPdf(fileBuffer, false).then(bytes => {
        download(bytes, 'slidez_' + fileName, "application/pdf");
    });
});

const {PDFDocument, rgb, degrees} = PDFLib;

async function drawNewPdf(orgBytes, preview) {
    return new Promise(async resolve => {
        let increaseValue = 1 + Number(slider.value) / 10;

        const pdfDoc = await PDFDocument.load(orgBytes);
        const newDoc = await PDFDocument.create();
        const pages = await pdfDoc.getPages();

        // this crazy condition is to use the same function for the preview and for the download function
        for (let i = 0; i < (preview ? 1 : pages.length); i++) {
            const oldPage = pages[i];

            const newPage = newDoc.addPage([
                Math.round(oldPage.getWidth() * increaseValue),
                Math.round(oldPage.getHeight() * increaseValue)
            ]);

            const workPage = await newDoc.embedPage(oldPage);
            const workPageDims = workPage.scale(1);

            let color = await getAvgColorFromPage(oldPage);

            await drawSVGBackground(newPage, color, {
                x: Math.round(newPage.getWidth() / 2 - workPageDims.width / 2),
                y: Math.round(newPage.getHeight() / 2 - workPageDims.height / 2),
                h: Math.round(oldPage.getHeight()),
                w: Math.round(oldPage.getWidth()),
            });

            await newPage.drawPage(workPage, {
                ...workPageDims,
                x: newPage.getWidth() / 2 - workPageDims.width / 2,
                y: newPage.getHeight() / 2 - workPageDims.height / 2,
            });
            await newPage.setRotation(degrees(rotation));
        }
        newDoc.save().then(bytes => resolve(bytes));

    });
}

async function drawSVGBackground(page, backColor, dims) {
    const externalPath = 'M 0 0 ' +
        'L 0 ' + Math.round(page.getHeight()) + ' ' +
        'L ' + Math.round(page.getWidth()) + ' ' + Math.round(page.getHeight()) + ' ' +
        'L ' + Math.round(page.getWidth()) + ' 0 ' +
        'L 0 0';

    await page.moveTo(0, page.getHeight())
    const color = hexToRgb(backColor);
    await page.drawSvgPath(externalPath, {color: rgb(color.r / 255, color.g / 255, color.b / 255)})

    if (checkDefaultBackground.checked) {
        // this is the oldPage background that we are painting
        const internalPath =
            'M 0 0 ' +
            'L ' + dims.w + ' 0 ' +
            'L ' + dims.w + ' ' + dims.h + ' ' +
            'L 0 ' + dims.h + ' ' +
            'L 0 0';
        await page.moveTo(dims.x, page.getHeight() - dims.y);
        await page.drawSvgPath(internalPath, {color: rgb(1, 1, 1)})
    }
}

async function getAvgColorFromPage(oldPage) {
    return new Promise(async resolve => {
        if (!checkAvgColor.checked) {
            resolve(colorPicker.value);
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d', {willReadFrequently: true});

        const newDoc = await PDFDocument.create();
        const newPage = newDoc.addPage([oldPage.getWidth(), oldPage.getHeight()]);
        const workPage = await newDoc.embedPage(oldPage);
        await newPage.drawPage(workPage);
        const bytes = await newDoc.save();

        let {pdfjsLib} = globalThis;
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/pdf.worker.mjs';
        pdfjsLib.getDocument({data: bytes}).promise.then(function (pdf) {

            pdf.getPage(1).then(function (page) {

                const viewport = page.getViewport({scale: 0.1});
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };
                page.render(renderContext).promise.then(() => {
                    resolve(fac.getColor(canvas).hex);
                });
            });
        });
    })


}

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}

function defaultPDF() {
    const b64data = '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ZSAvQUFBQUFBK0JlYmFzTmV1ZS1SZWd1bGFyCi9GbGFncyA0Ci9Bc2NlbnQgOTAwCi9EZXNjZW50IC0zMDAKL1N0ZW1WIDEyNQovQ2FwSGVpZ2h0IDcwMAovSXRhbGljQW5nbGUgMAovRm9udEJCb3ggWy0yMDkgLTIwMCA4MTAgOTEyXQovRm9udEZpbGUyIDEwIDAgUj4+CmVuZG9iagoxMiAwIG9iago8PC9UeXBlIC9Gb250Ci9Gb250RGVzY3JpcHRvciAxMSAwIFIKL0Jhc2VGb250IC9BQUFBQUErQmViYXNOZXVlLVJlZ3VsYXIKL1N1YnR5cGUgL0NJREZvbnRUeXBlMgovQ0lEVG9HSURNYXAgL0lkZW50aXR5Ci9DSURTeXN0ZW1JbmZvIDw8L1JlZ2lzdHJ5IChBZG9iZSkKL09yZGVyaW5nIChJZGVudGl0eSkKL1N1cHBsZW1lbnQgMD4+Ci9XIFswIFs3MzhdIDI5IFszNjNdIDcxIFs1MzhdIDc5IFs0MDBdIDkxIFszODZdIDEzMCBbNDA2XV0KL0RXIDM0ND4+CmVuZG9iagoxMyAwIG9iago8PC9GaWx0ZXIgL0ZsYXRlRGVjb2RlCi9MZW5ndGggMjU0Pj4gc3RyZWFtCnicXZBNa8MwDIbv/hU6tofiJDRbDyHQJQRy2AfL9gMcW8kMjW0c55B/P3+UDiaw4UF6Jb2iTd/2SjqgH1bzAR1MUgmLq94sRxhxlorkBQjJ3Z3izxdmCPXiYV8dLr2aNKkqAPrps6uzOxyuQo94JPTdCrRSzXD4bgbPw2bMDRdUDjJS1yBw8p1emXljCwKNslMvfF66/eQ1fxVfu0EoIudpG64FroZxtEzNSKrMRw1V56MmqMS//FNSjRP/YTZU562vzrJzWQc654maRM+J2kRdoi5S+RKpzCJdikSXOPPePUwPV3pY45u13lU8ZbQTjEiFj2sbbYIqvF9tVn0TCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PC9UeXBlIC9Gb250Ci9TdWJ0eXBlIC9UeXBlMAovQmFzZUZvbnQgL0FBQUFBQStCZWJhc05ldWUtUmVndWxhcgovRW5jb2RpbmcgL0lkZW50aXR5LUgKL0Rlc2NlbmRhbnRGb250cyBbMTIgMCBSXQovVG9Vbmljb2RlIDEzIDAgUj4+CmVuZG9iagp4cmVmCjAgMTQKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDE1IDAwMDAwIG4gCjAwMDAwMDIzODMgMDAwMDAgbiAKMDAwMDAwMDE3NSAwMDAwMCBuIAowMDAwMDAwMjEyIDAwMDAwIG4gCjAwMDAwMDcwNjIgMDAwMDAgbiAKMDAwMDAwMDI0OSAwMDAwMCBuIAowMDAwMDAwMzM0IDAwMDAwIG4gCjAwMDAwMDI2MTEgMDAwMDAgbiAKMDAwMDAwMjY2NiAwMDAwMCBuIAowMDAwMDAyNzgzIDAwMDAwIG4gCjAwMDAwMDYyNTkgMDAwMDAgbiAKMDAwMDAwNjQ2MSAwMDAwMCBuIAowMDAwMDA2NzM3IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSAxNAovUm9vdCA5IDAgUgovSW5mbyAxIDAgUj4+CnN0YXJ0eHJlZgo3MjExCiUlRU9GCg==';
    let binary = atob(b64data.replace(/\s/g, ''));
    let len = binary.length;
    let buffer = new ArrayBuffer(len);
    let view = new Uint8Array(buffer);
    for (let i = 0; i < len; i++) {
        view[i] = binary.charCodeAt(i);
    }
    fileBuffer = view;
    fileName = "EXEMPLO.pdf"
}

window.addEventListener('load', () => {
    defaultPDF();
    updatePDF();
});