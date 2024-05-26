
// only use cache stuff if we are not on production
const isDev = window.location.hostname == "localhost";
if ("serviceWorker" in navigator && !isDev) {
	window.addEventListener('load', async () => {
		try {
			const reg = await navigator.serviceWorker.register("/sw.js");
			console.log('Service worker registered', reg);
		} catch (err) {
			console.log('Service worker registration failed: ', err);
		}
	});
}


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
    let binary = atob(b64data.replace(/\s/g, '')); //b64Data is a constant from pdfData.js file
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