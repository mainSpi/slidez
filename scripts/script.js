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

const filePicker = document.getElementById('fileInput');
const colorPicker = document.getElementById('colorInput');
const button = document.getElementById('baixarButton');
const slider = document.getElementById('blankRange');


button.addEventListener('click', function (e) {
    e.preventDefault();
    let reader = new FileReader();
    reader.onload = function () {
        drawNewPdf(this.result).then(bytes =>
            download(bytes, 'slidez_' + filePicker.files[0].name, "application/pdf"));

    }
    reader.readAsArrayBuffer(filePicker.files[0]);

}, false);


const { PDFDocument, rgb } = PDFLib

async function drawNewPdf(orgBytes) {

    let increaseValue = 1.1 + Number(slider.value) / 10;

    console.log(increaseValue);

    const pdfDoc = await PDFDocument.load(orgBytes);
    const newDoc = await PDFDocument.create();

    for (const page of pdfDoc.getPages()) {
        const firstPage = newDoc.addPage([page.getWidth() * increaseValue, page.getHeight() * increaseValue]);
        drawSVGBackground(firstPage);

        const workPage = await newDoc.embedPage(page);
        const workPageDims = workPage.scale(1);

        firstPage.drawPage(workPage, {
            ...workPageDims,
            x: firstPage.getWidth() / 2 - workPageDims.width / 2,
            y: firstPage.getHeight() / 2 - workPageDims.height / 2,
        });
    }

    return await newDoc.save();

}

function drawSVGBackground(page) {
    const svgPath = 'M 0 0 ' +
        'L 0 ' + Math.round(page.getHeight()) + ' ' +
        'L ' + Math.round(page.getWidth()) + ' ' + Math.round(page.getHeight()) + ' ' +
        'L ' + Math.round(page.getWidth()) + ' 0 ' +
        'L 0 0';

    page.moveTo(0, page.getHeight())

    const color = hexToRgb(colorPicker.value);
    page.drawSvgPath(svgPath, { color: rgb(color.r / 255, color.g / 255, color.b / 255) })
}

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
    } : null;
}