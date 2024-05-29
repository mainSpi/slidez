// only use cache stuff if we are not on production
const isDev = window.location.hostname === "localhost";
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
const checkA4 = document.getElementById('checkA4');
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

filePicker.addEventListener('change', async () => {
    if (filePicker.files.length === 0) {
        return;
    }

    // get file names
    let a = Array.from(filePicker.files);

    // get file extensions
    let b = a.map(item => {
        let split = item.name.split('.');
        return split[split.length - 1].toLowerCase();
    });

    // select unique values from the extensions list
    let unique = b.filter((value, index, array) => array.indexOf(value) === index);

    // test all files to be of allowed extensions
    let haveForbiddenFile = unique
        .map(f => f === 'pdf' || f === 'png' || f === 'jpg' || f === 'jpeg')
        .includes(false);

    if (haveForbiddenFile) {
        alert("Somente as extensões .pdf .png .jpg .jpeg são permitidas!");
        filePicker.value = null;
        return;
    }

    // if its mixed AND it has a pdf (pdf + img something we dont want)
    if (unique.length > 1 && unique.includes('pdf')) {
        alert("Não misture PDF com imagens!");
        filePicker.value = null;
        return;
    }

    // if there are pdf's selected (doesn't matter how many)
    if (unique.length === 1 && unique[0] === 'pdf') {
        await buildPdf();
        return;
    }

    // if we are dealing with only images
    if (!unique.includes('pdf')) {
        await buildPdfFromImages();
    }
});
slider.addEventListener('change', updatePDF);
colorPicker.addEventListener('change', updatePDF);
checkDefaultBackground.addEventListener('change', updatePDF);
checkAvgColor.addEventListener('change', updatePDF);
checkA4.addEventListener('change', updatePDF);

button.addEventListener('click', function (e) {
    e.preventDefault();
    drawNewPdf(fileBuffer, false).then(bytes => {
        download(bytes, 'slidez_' + fileName, "application/pdf");
    });
});

const {PDFDocument, rgb, degrees, PageSizes} = PDFLib;

async function drawNewPdf(orgBytes, preview) {
    return new Promise(async resolve => {
        let increaseValue = 1 + Number(slider.value) / 10;

        const pdfDoc = await PDFDocument.load(orgBytes);
        const newDoc = await PDFDocument.create();
        const pages = await pdfDoc.getPages();

        // this crazy condition is to use the same function for the preview and for the download function
        for (let i = 0; i < (preview ? 1 : pages.length); i++) {
            let oldPage = pages[i];

            let color = await getAvgColorFromPage(oldPage);
            let newPage, workPage, workPageDims;

            // if it has to be A4 size (loses quality but can be printed easily)
            if (checkA4.checked) {
                // let a4Page = newDoc.addPage(PageSizes.A4);
                // oldPage = convertIntoA4();

                newPage = newDoc.addPage([
                    Math.round(oldPage.getWidth()),
                    Math.round(oldPage.getHeight())
                ]);

                workPage = await newDoc.embedPage(oldPage);
                workPageDims = workPage.scale(1 / increaseValue);

            } else { // increase page size to preserve resolution
                newPage = newDoc.addPage([
                    Math.round(oldPage.getWidth() * increaseValue),
                    Math.round(oldPage.getHeight() * increaseValue)
                ]);

                workPage = await newDoc.embedPage(oldPage);
                workPageDims = workPage.scale(1);
            }

            await drawSVGBackground(newPage, color, {
                x: Math.round(newPage.getWidth() / 2 - workPageDims.width / 2),
                y: Math.round(newPage.getHeight() / 2 - workPageDims.height / 2),
                h: Math.round(workPageDims.height),
                w: Math.round(workPageDims.width),
            });

            await newPage.drawPage(workPage, {
                ...workPageDims,
                x: newPage.getWidth() / 2 - workPageDims.width / 2,
                y: newPage.getHeight() / 2 - workPageDims.height / 2,
            });
            await newPage.setRotation(degrees(rotation + oldPage.getRotation().angle));
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

function readFileAsync(file) {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
    })
}

function createPdfName(list) {
    let name = '';

    list.forEach(s => name += s.split('.')[0].substring(0, 5) + '-');

    return name.substring(0, name.length - 1);
}

async function buildPdfFromImages() {

    const mainDoc = await PDFDocument.create();

    for (let i = 0; i < filePicker.files.length; i++) {
        let imageFile = filePicker.files[i];
        let split = imageFile.name.split('.');
        let extension = split[split.length - 1];
        let isPng = extension.toLowerCase() === 'png';

        let imgEmbedded;
        let angle;
        if (isPng) {
            imgEmbedded = await mainDoc.embedPng(await readFileAsync(imageFile));
        } else { // at this point, it can only be a jpg (or jpeg lol)
            let bytes = await readFileAsync(imageFile);
            imgEmbedded = await mainDoc.embedJpg(bytes);

            // fix exif orientation (ignoring flipping cause thats hard)
            let exif = getOrientation(bytes);
            if (exif === 3 || exif === 4) {
                angle = 180;
            } else if (exif === 6 || exif === 5) {
                angle = 90;
            } else if (exif === 8 || exif === 7) {
                angle = 270;
            }
        }

        const page = await mainDoc.addPage([imgEmbedded.width, imgEmbedded.height]);
        await page.drawImage(imgEmbedded);

        if (!isPng) {
            console.log('rotatinggg '+angle);
            await page.setRotation(degrees(angle));
        }
    }

    fileBuffer = await mainDoc.save();
    fileName = 'merge_' + createPdfName(Array.from(filePicker.files).map(f => f.name)) + '.pdf';
    updatePDF();
}

async function buildPdf() {

    // if we dont need to concatenate, then dont
    if (filePicker.files.length === 1) {
        console.log('um só')
        fileBuffer = await readFileAsync(filePicker.files[0]);
        fileName = filePicker.files[0].name;
    } else {
        const mainDoc = await PDFDocument.load(await readFileAsync(filePicker.files[0]));
        for (let i = 1; i < filePicker.files.length; i++) {
            const secDoc = await PDFDocument.load(await readFileAsync(filePicker.files[i]));
            const copiedPagesA = await mainDoc.copyPages(secDoc, secDoc.getPageIndices());
            copiedPagesA.forEach((page) => mainDoc.addPage(page));
        }

        fileBuffer = await mainDoc.save();
        fileName = 'merge_' + createPdfName(Array.from(filePicker.files).map(f => f.name)) + '.pdf';
    }

    updatePDF();
}

// https://stackoverflow.com/questions/7584794/accessing-jpeg-exif-rotation-data-in-javascript-on-the-client-side
function getOrientation(bytes) {
    let view = new DataView(bytes);
    if (view.getUint16(0, false) !== 0xFFD8) {
        return -2;
    }
    let length = view.byteLength, offset = 2;
    while (offset < length) {
        if (view.getUint16(offset + 2, false) <= 8) return -1;
        let marker = view.getUint16(offset, false);
        offset += 2;
        if (marker === 0xFFE1) {
            if (view.getUint32(offset += 2, false) !== 0x45786966) {
                return -1;
            }
            let little = view.getUint16(offset += 6, false) === 0x4949;
            offset += view.getUint32(offset + 4, little);
            let tags = view.getUint16(offset, little);
            offset += 2;
            for (let i = 0; i < tags; i++) {
                if (view.getUint16(offset + (i * 12), little) === 0x0112) {
                    return view.getUint16(offset + (i * 12) + 8, little);
                }
            }
        } else if ((marker & 0xFF00) !== 0xFF00) {
            break;
        } else {
            offset += view.getUint16(offset, false);
        }
    }
    return -1;

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