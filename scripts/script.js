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
const canvas = document.getElementById('the-canvas');
const context = canvas.getContext('2d');

function updatePDF() {

	let reader = new FileReader();
	reader.onload = function () {
		drawNewPdf(this.result, true).then(bytes => {
			let pdfData = bytes;

			// Loaded via <script> tag, create shortcut to access PDF.js exports.
			var { pdfjsLib } = globalThis;

			// The workerSrc property shall be specified.
			pdfjsLib.GlobalWorkerOptions.workerSrc = '/scripts/pdf.worker.mjs';

			// Using DocumentInitParameters object to load binary data.
			var loadingTask = pdfjsLib.getDocument({ data: pdfData });
			loadingTask.promise.then(function (pdf) {

				pdf.getPage(1).then(function (page) {

					var viewport = page.getViewport({ scale: 1 });

					// Prepare canvas using PDF page dimensions
					canvas.height = viewport.height;
					canvas.width = viewport.width;

					// Render PDF page into canvas context
					var renderContext = {
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

button.addEventListener('click', function (e) {
	e.preventDefault();
	let reader = new FileReader();
	reader.onload = function () {
		drawNewPdf(this.result, false).then(bytes =>
			download(bytes, 'slidez_' + filePicker.files[0].name, "application/pdf"));

	}
	reader.readAsArrayBuffer(filePicker.files[0]);

}, false);


const { PDFDocument, rgb, degrees } = PDFLib

async function drawNewPdf(orgBytes, preview) {

	let increaseValue = 1.1 + Number(slider.value) / 10;

	const pdfDoc = await PDFDocument.load(orgBytes);
	const newDoc = await PDFDocument.create();
	const pages = await pdfDoc.getPages();

	for (let i = 0; i < (preview ? 1 : pages.length); i++) {
		const page = pages[i];

		const firstPage = newDoc.addPage([page.getWidth() * increaseValue, page.getHeight() * increaseValue]);
		drawSVGBackground(firstPage);

		const workPage = await newDoc.embedPage(page);
		const workPageDims = workPage.scale(1);

		firstPage.drawPage(workPage, {
			...workPageDims,
			x: firstPage.getWidth() / 2 - workPageDims.width / 2,
			y: firstPage.getHeight() / 2 - workPageDims.height / 2,
			//rotate: degrees(720),
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