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
const downloadButton = document.getElementById('baixarButton');
const rotateButton = document.getElementById('rotateBtn');
const slider = document.getElementById('blankRange');
const displayCanvas = document.getElementById('the-canvas');
const checkDefaultBackground = document.getElementById('checkDefaultBackground');
const checkAvgColor = document.getElementById('checkAvgColor');
const checkA4 = document.getElementById('checkA4');
const loadingModal = new bootstrap.Modal(document.getElementById("staticBackdrop")); // dont ask questions https://www.sitepoint.com/community/t/how-toggle-bootstrap-5-modal-without-button-click/363536/2
const fileList = document.getElementById('fileList');

const fac = new FastAverageColor();
const { PDFDocument, rgb, degrees, PageSizes } = PDFLib;
let rotation = 0;
let fileBuffer = '';
let fileName = '';

slider.addEventListener('change', updatePDF);
colorPicker.addEventListener('change', updatePDF);
checkDefaultBackground.addEventListener('change', updatePDF);
checkAvgColor.addEventListener('change', updatePDF);
checkA4.addEventListener('change', updatePDF);

window.addEventListener('load', () => {
    defaultPDF();
    updatePDFNoModal();
});
downloadButton.addEventListener('click', function (e) {
    setLoading(false);
    e.preventDefault();
    drawNewPdf(fileBuffer, false).then(bytes => {
        download(bytes, 'slidez_' + fileName, "application/pdf");
        setLoading(true);
    });
});
rotateButton.addEventListener('click', () => {
    rotation += 90;
    if (rotation === 360) {
        rotation = 0;
    }
    updatePDF();
});
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
    }

    // if we are dealing with only images
    if (!unique.includes('pdf')) {
        await buildPdfFromImages();
    }

    refreshFileList(filePicker.files);
});

function setLoading(isDone) {
    let things = [filePicker, colorPicker, checkA4, checkAvgColor, checkDefaultBackground, rotateButton, downloadButton, slider];
    if (isDone) { // stop loading
        things.forEach(e => e.removeAttribute('disabled'));
        loadingModal.hide();
        // sometimes it loads to quick and it cant hide properly
        setTimeout(() => loadingModal.hide(), 1000);
    } else { // start loading
        things.forEach(e => e.setAttribute('disabled', ''));
        loadingModal.show();
    }
}

async function displayPDF(pdfData, canvas, scale) {
    let { pdfjsLib } = globalThis;
    pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/pdf.worker.mjs';
    const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const page = await pdf.getPage(1);

    const viewport = page.getViewport({ scale: scale });

    // Prepare canvas using PDF page dimensions
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    // Render PDF page into canvas context
    const renderContext = {
        canvasContext: canvas.getContext('2d', { willReadFrequently: true }), // https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
        viewport: viewport
    };
    return page.render(renderContext).promise;
}

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

                oldPage = await pageToA4(oldPage);

                newPage = newDoc.addPage([
                    oldPage.getWidth(),
                    oldPage.getHeight()
                ]);

                workPage = await newDoc.embedPage(oldPage);
                workPageDims = workPage.scale(1 / increaseValue);

            } else { // increase page size to preserve resolution
                newPage = newDoc.addPage([
                    oldPage.getWidth() * increaseValue,
                    oldPage.getHeight() * increaseValue
                ]);

                workPage = await newDoc.embedPage(oldPage);
                workPageDims = workPage.scale(1);
            }

            await drawSVGBackground(newPage, color, {
                x: newPage.getWidth() / 2 - workPageDims.width / 2,
                y: newPage.getHeight() / 2 - workPageDims.height / 2,
                h: workPageDims.height,
                w: workPageDims.width,
            });

            await newPage.drawPage(workPage, {
                ...workPageDims,
                x: newPage.getWidth() / 2 - workPageDims.width / 2,
                y: newPage.getHeight() / 2 - workPageDims.height / 2,
            });
            await newPage.setRotation(degrees(rotation + oldPage.getRotation().angle));
        }
        resolve(await newDoc.save());

    });
}

async function drawSVGBackground(page, backColor, dims) {
    const externalPath = 'M 0 0 ' +
        'L 0 ' + page.getHeight() + ' ' +
        'L ' + page.getWidth() + ' ' + page.getHeight() + ' ' +
        'L ' + page.getWidth() + ' 0 ' +
        'L 0 0';

    await page.moveTo(0, page.getHeight())
    const color = hexToRgb(backColor);
    await page.drawSvgPath(externalPath, { color: rgb(color.r / 255, color.g / 255, color.b / 255) })

    if (checkDefaultBackground.checked) {
        // this is the oldPage background that we are painting
        const internalPath =
            'M 0 0 ' +
            'L ' + dims.w + ' 0 ' +
            'L ' + dims.w + ' ' + dims.h + ' ' +
            'L 0 ' + dims.h + ' ' +
            'L 0 0';
        await page.moveTo(dims.x, page.getHeight() - dims.y);
        await page.drawSvgPath(internalPath, { color: rgb(1, 1, 1) })
    }
}

async function getAvgColorFromPage(oldPage) {
    return new Promise(async resolve => {
        // if we dont have to, then dont
        if (!checkAvgColor.checked) {
            resolve(colorPicker.value);
            return;
        }

        const canvas = document.createElement('canvas');

        const newDoc = await PDFDocument.create();
        const newPage = newDoc.addPage([oldPage.getWidth(), oldPage.getHeight()]);
        const workPage = await newDoc.embedPage(oldPage);
        await newPage.drawPage(workPage);
        const bytes = await newDoc.save();

        displayPDF(bytes, canvas, 0.1).then(() => {
            resolve(fac.getColor(canvas).hex);
        });
    })


}

async function pageToA4(page) {
    const pdfDoc = await PDFDocument.create();
    const a4Page = await pdfDoc.addPage(PageSizes.A4);

    const embOddPage = await pdfDoc.embedPage(page);

    let fx = PageSizes.A4[0] / embOddPage.width;
    let fy = PageSizes.A4[1] / embOddPage.height;

    let newScale = ((fx >= fy) ? fy : fx);
    let embOddPageDims = await embOddPage.scale(newScale);

    await a4Page.drawPage(embOddPage, {
        ...embOddPageDims,
        x: a4Page.getWidth() / 2 - embOddPageDims.width / 2,
        y: a4Page.getHeight() / 2 - embOddPageDims.height / 2,
    });

    await pdfDoc.save();

    return a4Page;
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

function readFileAsyncURL(file) {
    return new Promise((resolve, reject) => {
        let reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    })
}

function createPdfName(list) {
    let name = '';

    list.forEach(s => name += s.split('.')[0].substring(0, 5) + '-');

    return name.substring(0, name.length - 1);
}

async function buildPdfFromImages() {
    setLoading(false);
    const mainDoc = await PDFDocument.create();

    let embArray = new Array(filePicker.files.length);

    for (let i = 0; i < filePicker.files.length; i++) {
        let imageFile = filePicker.files[i];
        let split = imageFile.name.split('.');
        let extension = split[split.length - 1];
        let isPng = extension.toLowerCase() === 'png';

        let imgEmbedded;
        if (isPng) {
            imgEmbedded = await mainDoc.embedPng(await readFileAsync(imageFile));
        } else { // at this point, it can only be a jpg (or jpeg lol)

            // extract exif
            let bytes = await readFileAsync(imageFile);
            let angle = 0;
            let exif = getOrientation(bytes);
            if (exif === 3 || exif === 4) {
                angle = 180;
            } else if (exif === 6 || exif === 5) {
                angle = 90;
            } else if (exif === 8 || exif === 7) {
                angle = 270;
            }

            // if there is no exif
            if (angle === 0) {
                imgEmbedded = await mainDoc.embedJpg(bytes);
            } else {
                // all this shit is to fix exif orientation
                let dataUrl = await readFileAsyncURL(imageFile);

                const imageHidden = document.createElement('img');
                imageHidden.src = dataUrl;
                const canvas = document.createElement('canvas');

                imageHidden.addEventListener('load', () => {
                    canvas.width = imageHidden.naturalWidth
                    canvas.height = imageHidden.naturalHeight;

                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(imageHidden, 0, 0);

                    canvas.toBlob(async (blob) => {
                        let arrayBuffer = await blob.arrayBuffer();
                        imgEmbedded = await mainDoc.embedPng(arrayBuffer);

                    }, "image/png");

                });
            }

        }

        let interval = setInterval(async () => {
            if (imgEmbedded) {
                embArray[i] = imgEmbedded;
                clearInterval(interval);
            }
        }, 100);
    }

    let interval = setInterval(async () => {
        let allDone = true;
        for (let i = 0; i < filePicker.files.length; i++) {
            if (allDone) {
                if (!embArray[i]) {
                    allDone = false;
                }
            }
        }
        if (allDone) {
            for (const imgEmbedded of embArray) {
                const page = await mainDoc.addPage([imgEmbedded.width, imgEmbedded.height]);
                await page.drawImage(imgEmbedded);
            }
            fileBuffer = await mainDoc.save();
            if (filePicker.files.length > 1) {
                fileName = 'merge_' + createPdfName(Array.from(filePicker.files).map(f => f.name)) + '.pdf';
            } else {
                fileName = filePicker.files[0].name;
            }

            updatePDFNoModal();
            clearInterval(interval);
        }
    }, 100);

}

async function buildPdf() {
    // if we dont need to concatenate, then dont
    if (filePicker.files.length === 1) {
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

function updatePDF() {
    setLoading(false);
    updatePDFNoModal();
}

// dont show the modal (just hide it lmao)
function updatePDFNoModal() {
    drawNewPdf(fileBuffer, true).then(bytes => {
        displayPDF(bytes, displayCanvas, 1).then(() => setLoading(true));
    });
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

async function refreshFileList(list) {

    while (fileList.children.length > 0) {
        fileList.removeChild(fileList.children[0]);
    }

    for (let k = 0; k < list.length; k++) {
        const f = list[k];

        const li = document.createElement('li');
        li.setAttribute('class', 'list-group-item d-flex justify-content-between align-items-center li-list-item');
        li.setAttribute('draggable', 'true');
        li.setAttribute('fileIndex', k);

        const i = document.createElement('i');
        i.setAttribute('class', 'bi bi-arrow-down-up i-list-item');

        const p = document.createElement('p');
        p.setAttribute('class', 'p-list-item');
        p.innerText = f.name;

        const img = document.createElement('img');
        img.setAttribute('class', 'img-list-item');
        let split = f.name.split('.');
        let extension = split[split.length - 1].toLowerCase();

        if (extension === 'pdf') {
            const canvas = document.createElement('canvas');
            // i prefer using await but this makes the list load in slowly. With this it loads instantantly but with empty images.
            readFileAsync(f).then((bytes) => {
                displayPDF(bytes, canvas, 1).then(() => {
                    img.src = canvas.toDataURL();
                });
            });
        } else {
            readFileAsyncURL(f).then((url) => img.src = url);
        }
        img.setAttribute('draggable', 'false');

        li.appendChild(i);
        li.appendChild(p);
        li.appendChild(img);
        fileList.appendChild(li);
    }

}

function clearActive() {
    for (const li of fileList.children) {
        li.classList.remove('active');
    }
}

// FILE LIST SECTION
let draggedItem = null;
fileList.addEventListener(
    "dragstart",
    (e) => {
        draggedItem = e.target;
        clearActive();
        draggedItem.classList.add('active');
        setTimeout(() => {
            e.target.style.display =
                "none";
        }, 0);
    });

fileList.addEventListener(
    "dragend",
    (e) => {
        setTimeout(() => {
            e.target.style.display = "";
            clearActive();
            draggedItem = null;
        }, 0);
    });

fileList.addEventListener(
    "dragover",
    (e) => {
        e.preventDefault();
        const afterElement =
            getDragAfterElement(
                fileList,
                e.clientY);
        if (afterElement == null) {
            fileList.appendChild(
                draggedItem
            );
        }
        else {
            fileList.insertBefore(
                draggedItem,
                afterElement
            );
        }
    });

const getDragAfterElement = (
    container, y
) => {
    const draggableElements = [
        ...container.querySelectorAll(
            "li:not(.dragging)"
        ),];

    return draggableElements.reduce(
        (closest, child) => {
            const box =
                child.getBoundingClientRect();
            const offset =
                y - box.top - box.height / 2;
            if (
                offset < 0 &&
                offset > closest.offset) {
                return {
                    offset: offset,
                    element: child,
                };
            }
            else {
                return closest;
            }
        },
        {
            offset: Number.NEGATIVE_INFINITY,
        }
    ).element;
};
