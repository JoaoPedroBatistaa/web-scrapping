const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

async function findPuzzlePosition (page) {

    let puzzleImageUrl = await page.$eval('[class*="geetest_slice_bg"]', element => {
        return element.style.backgroundImage.slice(5, -2);
    });

    if (!puzzleImageUrl|| !puzzleImageUrl.startsWith('http')) {
        console.error("URL do captcha inválida:", puzzleImageUrl);
        return;
    }

    const puzzleImageBuffer = await page.goto(puzzleImageUrl).then(response => response.buffer());

    await fs.writeFile('./puzzle.png', puzzleImageBuffer);

    let srcPuzzleImage = await Jimp.read('./puzzle.png')
    let srcPuzzle = cv.matFromImageData(srcPuzzleImage.bitmap)
    let dstPuzzle = new cv.Mat()

    cv.cvtColor(srcPuzzle, srcPuzzle, cv.COLOR_BGR2GRAY)
    cv.threshold(srcPuzzle, dstPuzzle, 127, 255, cv.THRESH_BINARY)

    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)
    cv.dilate(dstPuzzle, dstPuzzle, kernel, anchor, 1)
    cv.erode(dstPuzzle, dstPuzzle, kernel, anchor, 1)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dstPuzzle, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function findDiffPosition (page) {
    await page.waitFor(100)

    let srcImage = await Jimp.read('./diff.png')
    let src = cv.matFromImageData(srcImage.bitmap)

    let dst = new cv.Mat()
    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1)
    let anchor = new cv.Point(-1, -1)

    cv.threshold(src, dst, 127, 255, cv.THRESH_BINARY)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)
    cv.erode(dst, dst, kernel, anchor, 1)
    cv.dilate(dst, dst, kernel, anchor, 1)

    cv.cvtColor(dst, dst, cv.COLOR_BGR2GRAY)
    cv.threshold(dst, dst, 150, 255, cv.THRESH_BINARY_INV)

    let contours = new cv.MatVector()
    let hierarchy = new cv.Mat()
    cv.findContours(dst, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    let contour = contours.get(0)
    let moment = cv.moments(contour)

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)]
}

async function saveSliderCaptchaImages(page) {
    await page.waitForSelector('.MuiButton-label');
    await page.click('.MuiButton-label');

    // Aguarda o carregamento das imagens
    await page.waitForSelector('[class*="geetest_bg_"], [class*="geetest_slice_bg"]', { visible: true });
    await page.waitFor(1000);

    // Extrai a URL de backgroundImage da imagem completa
    let originalImageUrl = await page.$eval('[class*="geetest_bg_"]', element => {
        return element.style.backgroundImage.slice(5, -2); // Extrai URL de "url("https://...")"
    });

    // Extrai a URL de backgroundImage da peça do puzzle
    let captchaImageUrl = await page.$eval('[class*="geetest_slice_bg"]', element => {
        return element.style.backgroundImage.slice(5, -2); // Extrai URL de "url("https://...")"
    });

    console.log('URL da imagem original:', originalImageUrl);
    console.log('URL da imagem do captcha:', captchaImageUrl);

    if (!originalImageUrl || !originalImageUrl.startsWith('http')) {
        console.error("URL da imagem original inválida:", originalImageUrl);
        return;
    }

    if (!captchaImageUrl || !captchaImageUrl.startsWith('http')) {
        console.error("URL do captcha inválida:", captchaImageUrl);
        return;
    }

    const captchaImageBuffer = await page.goto(captchaImageUrl).then(response => response.buffer());
    const originalImageBuffer = await page.goto(originalImageUrl).then(response => response.buffer());

    await fs.writeFile('./captcha.png', captchaImageBuffer);
    await fs.writeFile('./original.png', originalImageBuffer);
}

async function findPuzzleCenter(imagePath) {
    let srcPuzzleImage = await Jimp.read(imagePath);
    let srcPuzzle = cv.matFromImageData(srcPuzzleImage.bitmap);
    let dstPuzzle = new cv.Mat();

    cv.cvtColor(srcPuzzle, srcPuzzle, cv.COLOR_BGR2GRAY);
    cv.threshold(srcPuzzle, dstPuzzle, 127, 255, cv.THRESH_BINARY);

    let kernel = cv.Mat.ones(5, 5, cv.CV_8UC1);
    let anchor = new cv.Point(-1, -1);
    cv.dilate(dstPuzzle, dstPuzzle, kernel, anchor, 1);
    cv.erode(dstPuzzle, dstPuzzle, kernel, anchor, 1);

    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();
    cv.findContours(dstPuzzle, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let contour = contours.get(0);
    let moment = cv.moments(contour);

    srcPuzzle.delete();
    dstPuzzle.delete();
    kernel.delete();
    contours.delete();
    hierarchy.delete();

    return [Math.floor(moment.m10 / moment.m00), Math.floor(moment.m01 / moment.m00)];
}



async function saveDiffImage() {
    const originalImage = await Jimp.read('./original.png');
    const captchaImage = await Jimp.read('./captcha.png');

    const whiteImage = new Jimp(captchaImage.bitmap.width, captchaImage.bitmap.height, 0xFFFFFFFF);

    const maskImage = new Jimp(captchaImage.bitmap.width, captchaImage.bitmap.height);
    pixelmatch(
        captchaImage.bitmap.data,
        whiteImage.bitmap.data,
        maskImage.bitmap.data,
        captchaImage.bitmap.width,
        captchaImage.bitmap.height,
        { threshold: 0.5 }
    );

    maskImage.write('./mask.png');

    const originalMat = jimpToMat(originalImage);
    const maskMat = jimpToMat(maskImage);

    const kernel = new cv.Mat.ones(3, 3, cv.CV_8U);
    cv.erode(maskMat, maskMat, kernel, new cv.Point(-1, -1), 1);
    cv.dilate(maskMat, maskMat, kernel, new cv.Point(-1, -1), 1);

    const resultMat = new cv.Mat();
    cv.matchTemplate(originalMat, maskMat, resultMat, cv.TM_CCOEFF_NORMED);

    const { maxLoc } = cv.minMaxLoc(resultMat);

    console.log("Melhor posição para a peça do quebra-cabeça:", maxLoc);

    const [centerX, centerY] = await findPuzzleCenter('./captcha.png');
    console.log("Centro da peça do quebra-cabeça:", centerX, centerY);

    originalMat.delete();
    maskMat.delete();
    resultMat.delete();
    kernel.delete();
    originalMat.delete();
    maskMat.delete();
    resultMat.delete();
    kernel.delete();
}

function jimpToMat(image) {
    const { width, height, data } = image.bitmap;
    const mat = new cv.Mat(height, width, cv.CV_8UC4);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = (y * width + x) * 4;
            mat.data[idx] = data[idx];
            mat.data[idx + 1] = data[idx + 1];
            mat.data[idx + 2] = data[idx + 2];
            mat.data[idx + 3] = data[idx + 3];
        }
    }

    return mat;
}

async function run () {
    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1366, height: 768 }
    })
    const page = await browser.newPage()

    await page.goto('https://www.chiliz.net/login?redirect=https%3A%2F%2Fwww.chiliz.net%2F', { waitUntil: 'networkidle2' })

    await page.waitForSelector('.MuiButtonBase-root.MuiButton-root.MuiButton-contained.MuiButton-containedPrimary.MuiButton-containedSizeSmall.MuiButton-sizeSmall');
    await page.click('.MuiButtonBase-root.MuiButton-root.MuiButton-contained.MuiButton-containedPrimary.MuiButton-containedSizeSmall.MuiButton-sizeSmall');


    await page.waitForSelector('input[placeholder="Please enter email address or phone number"]');
    await page.type('input[placeholder="Please enter email address or phone number"]', 'joaopbatistastos@gmail.com');

    await page.waitForSelector('input[placeholder="Enter the password"]');
    await page.type('input[placeholder="Enter the password"]', '153486153.Joao');

    await page.waitFor(1000)

    await saveSliderCaptchaImages(page)
    await saveDiffImage()

    let [cx, cy] = await findDiffPosition(page)

    const sliderHandle = await page.$('.geetest_slider ');
    const handle = await sliderHandle.boundingBox()

    let xPosition = handle.x + handle.width / 2
    let yPosition = handle.y + handle.height / 2
    await page.mouse.move(xPosition, yPosition)
    await page.mouse.down()

    xPosition = handle.x + cx - handle.width / 2
    yPosition = handle.y + handle.height / 3
    await page.mouse.move(xPosition, yPosition, { steps: 25 })

    await page.waitFor(100)

    let [cxPuzzle, cyPuzzle] = await findPuzzlePosition(page)

    xPosition = xPosition + cx - cxPuzzle
    yPosition = handle.y + handle.height / 2
    await page.mouse.move(xPosition, yPosition, { steps: 5 })
    await page.mouse.up()

    await page.waitFor(3000)
    // success!

    await fs.unlink('./original.png')
    await fs.unlink('./captcha.png')
    await fs.unlink('./diff.png')
    await fs.unlink('./puzzle.png')

    await browser.close()
}

run()
