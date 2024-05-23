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
const context = displayCanvas.getContext('2d');
const fac = new FastAverageColor();

let rotation = 0;
rotateButton.addEventListener('click', () => {
    rotation += 90;
    if (rotation === 360) {
        rotation = 0;
    }
    updatePDF();
});

function updatePDF() {

    let reader = new FileReader();
    reader.onload = function () {
        drawNewPdf(this.result, true).then(bytes => {
            let pdfData = bytes;

            // Loaded via <script> tag, create shortcut to access PDF.js exports.
            let {pdfjsLib} = globalThis;

            // The workerSrc property shall be specified.
            pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/pdf.worker.mjs';

            // Using DocumentInitParameters object to load binary data.
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
        });
    }
    reader.readAsArrayBuffer(filePicker.files[0]);
}

slider.addEventListener('change', updatePDF);
filePicker.addEventListener('change', updatePDF);
colorPicker.addEventListener('change', updatePDF);
checkDefaultBackground.addEventListener('change', updatePDF);
checkAvgColor.addEventListener('change', updatePDF);

button.addEventListener('click', function (e) {
    e.preventDefault();
    let reader = new FileReader();
    reader.onload = function () {
        drawNewPdf(this.result, false).then(bytes =>
            download(bytes, 'slidez_' + filePicker.files[0].name, "application/pdf"));

    }
    reader.readAsArrayBuffer(filePicker.files[0]);

}, false);

const {PDFDocument, rgb, degrees} = PDFLib;

async function drawNewPdf(orgBytes, preview) {

    let increaseValue = 1.1 + Number(slider.value) / 10;

    const pdfDoc = await PDFDocument.load(orgBytes);
    const newDoc = await PDFDocument.create();
    const pages = await pdfDoc.getPages();

    for (let i = 0; i < (preview ? 1 : pages.length); i++) {
        const oldPage = pages[i];

        ;

        const newPage = newDoc.addPage([
            Math.round(oldPage.getWidth() * increaseValue),
            Math.round(oldPage.getHeight() * increaseValue)
        ]);

        const workPage = await newDoc.embedPage(oldPage);
        const workPageDims = workPage.scale(1);

        getAvgColorFromPage(oldPage).then(color => {
            // debugger;
            console.log(color);
            drawSVGBackground(newPage, color, {
                x: Math.round(newPage.getWidth() / 2 - workPageDims.width / 2),
                y: Math.round(newPage.getHeight() / 2 - workPageDims.height / 2),
                h: Math.round(oldPage.getHeight()),
                w: Math.round(oldPage.getWidth()),
            });

            newPage.drawPage(workPage, {
                ...workPageDims,
                x: newPage.getWidth() / 2 - workPageDims.width / 2,
                y: newPage.getHeight() / 2 - workPageDims.height / 2,
                //rotate: degrees(720),
            });
            newPage.setRotation(degrees(rotation))
        })
    }

    return await newDoc.save();

}

function drawSVGBackground(page, backColor, dims) {
    const externalPath = 'M 0 0 ' +
        'L 0 ' + Math.round(page.getHeight()) + ' ' +
        'L ' + Math.round(page.getWidth()) + ' ' + Math.round(page.getHeight()) + ' ' +
        'L ' + Math.round(page.getWidth()) + ' 0 ' +
        'L 0 0';

    page.moveTo(0, page.getHeight())
    const color = hexToRgb(backColor);
    page.drawSvgPath(externalPath, {color: rgb(color.r / 255, color.g / 255, color.b / 255)})

    if (checkDefaultBackground.checked) {
        // this is the oldPage background that we are painting
        const internalPath =
            'M 0 0 ' +
            'L ' + dims.w + ' 0 ' +
            'L ' + dims.w + ' ' + dims.h + ' ' +
            'L 0 ' + dims.h + ' ' +
            'L 0 0';
        page.moveTo(dims.x, page.getHeight() - dims.y);
        page.drawSvgPath(internalPath, {color: rgb(1, 1, 1)})
    }
}

async function getAvgColorFromPage(oldPage) {
    return new Promise(async resolve => {
        if (!checkAvgColor.checked) {
            resolve(colorPicker.value);
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        const newDoc = await PDFDocument.create();
        const newPage = newDoc.addPage([oldPage.getWidth(), oldPage.getHeight()]);
        const workPage = await newDoc.embedPage(oldPage);
        await newPage.drawPage(workPage);
        const bytes = await newDoc.save();

        let {pdfjsLib} = globalThis;
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/pdf.worker.mjs';
        pdfjsLib.getDocument({data: bytes}).promise.then(function (pdf) {

            pdf.getPage(1).then(function (page) {

                const viewport = page.getViewport({scale: 1});
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport
                };
                page.render(renderContext).promise.then(() => {
                    fac.getColorAsync(canvas)
                        .then(color => {
                            resolve(color.hex);
                        });
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