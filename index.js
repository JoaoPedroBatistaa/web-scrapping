const puppeteer = require('puppeteer')
const fs = require('fs').promises
const Jimp = require('jimp')
const pixelmatch = require('pixelmatch')
const { cv } = require('opencv-wasm')

async function saveSliderCaptchaImages(page) {
    await page.waitForSelector('.MuiButton-label');
    await page.click('.MuiButton-label');

    await page.waitForSelector('[class*="geetest_bg_"], [class*="geetest_slice_bg"]', { visible: true });
    await page.waitFor(1000);

    let originalImageUrl = await page.$eval('[class*="geetest_bg_"]', element => {
        return element.style.backgroundImage.slice(5, -2);
    });

    let captchaImageUrl = await page.$eval('[class*="geetest_slice_bg"]', element => {
        return element.style.backgroundImage.slice(5, -2);
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

    const browser = await page.browser();
    const newPage = await browser.newPage();

    const captchaImageBuffer = await newPage.goto(captchaImageUrl).then(response => response.buffer());
    await fs.writeFile('./captcha.png', captchaImageBuffer);

    const originalImageBuffer = await newPage.goto(originalImageUrl).then(response => response.buffer());
    await fs.writeFile('./original.png', originalImageBuffer);

    await newPage.close();
}

async function saveDiffImage() {
    const originalImage = await Jimp.read('./original.png');
    const captchaImage = await Jimp.read('./captcha.png');
    const transparentImage = new Jimp(captchaImage.bitmap.width, captchaImage.bitmap.height, 0x00000000);

    const { width, height } = transparentImage.bitmap;
    const diffImage = new Jimp(width, height);

    const diffOptions = { includeAA: true, threshold: 0.2 };

    pixelmatch(transparentImage.bitmap.data, captchaImage.bitmap.data, diffImage.bitmap.data, width, height, diffOptions);
    diffImage.write('./diff.png');

    const originalMat = jimpToMat(originalImage);
    const maskMat = jimpToMat(diffImage);

    const kernel = new cv.Mat.ones(3, 3, cv.CV_8U);
    cv.erode(maskMat, maskMat, kernel, new cv.Point(-1, -1), 1);
    cv.dilate(maskMat, maskMat, kernel, new cv.Point(-1, -1), 1);

    const resultMat = new cv.Mat();
    cv.matchTemplate(originalMat, maskMat, resultMat, cv.TM_CCOEFF_NORMED);

    const { maxLoc } = cv.minMaxLoc(resultMat);

    let adjustment = 3;

    const pieceCenterX = maxLoc.x + (maskMat.cols / 2) + adjustment;
    const pieceCenterY = maxLoc.y + (maskMat.rows / 2);

    console.log("Melhor posição para o centro da peça do quebra-cabeça:", { x: pieceCenterX, y: pieceCenterY });

    originalMat.delete();
    maskMat.delete();
    resultMat.delete();
    kernel.delete();

    return pieceCenterX;
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

async function solveCaptcha(page, pieceCenterXValue) {
    await page.waitForSelector('.geetest_btn');

    const sliderButton = await page.$('.geetest_btn');
    const buttonBox = await sliderButton.boundingBox();

    let xPosition = buttonBox.x + buttonBox.width;
    let yPosition = buttonBox.y + buttonBox.height / 2;

    await page.mouse.move(xPosition, yPosition);

    await page.mouse.down();

    xPosition += pieceCenterXValue - 60;

    await page.mouse.move(xPosition, yPosition, { steps: 30 });

    await page.waitFor(100);

    await page.mouse.up();

    await page.waitFor(3000);
}

async function isCaptchaSolved(page) {
    try {
        await page.waitForSelector('a[href="/finance/"]', { timeout: 5000 });
        return true;
    } catch (error) {
        return false;
    }
}


async function clickBalanceLink(page) {
    try {
        await page.waitForSelector('a[href="/finance/"]', { timeout: 10000 });

        await page.click('a[href="/finance/"]');

        console.log("Link 'Balance' clicado com sucesso!");

    } catch (error) {
        console.error("Erro ao clicar no link 'Balance':", error.message);
    }
}


async function extractWithdrawFees(page) {
    await page.waitForSelector('.list');

    // Obtenha todos os elementos 'item'
    const items = await page.$$('.list .item');
    let withdrawFees = [];

    for (let item of items) {
        let currencyCode = '';
        let currencyName = '';

        try {
            const nameDiv = await item.$('div:first-child .jss57');
            [currencyCode, currencyName] = await nameDiv.$$eval('span', spans => spans.map(span => span.innerText));

            if (currencyCode === 'BNB-BEP20') {
                // console.log("Pulando BNB-BEP20.");
                continue;
            }

            const withdrawLink = await item.$('div:last-child a[href^="/finance/cash/"]');

            if (!withdrawLink) {
                continue;
            }

            const linkUrl = await withdrawLink.evaluate(link => link.href);

            const newTab = await page.browser().newPage();
            await newTab.goto(linkUrl);

            const feeLabel = await newTab.waitForSelector('label[data-shrink="true"] strong.jss155', {timeout: 5000});
            const fee = await feeLabel.evaluate(strong => strong.innerText.split(': ')[1]);

            withdrawFees.push([currencyName, currencyCode, fee]);
            // console.log([currencyName, currencyCode, fee]);
            await newTab.close();

        } catch (error) {
            // console.warn(`Erro ao processar o item '${currencyName} (${currencyCode})': ${error.message}`);
            await newTab.close();
            continue;
        }
    }

    return withdrawFees;
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

    while (true) {
        await saveSliderCaptchaImages(page);
        const pieceCenterXValue = await saveDiffImage();
        await solveCaptcha(page, pieceCenterXValue);

        if (await isCaptchaSolved(page)) {
            console.log("CAPTCHA resolvido com sucesso!");
            await clickBalanceLink(page);
            break;
        } else {
            console.log("Tentando resolver o CAPTCHA novamente...");
        }
    }

    await page.waitFor(3000)
    // success!

    await fs.unlink('./original.png')
    await fs.unlink('./captcha.png')
    await fs.unlink('./diff.png')

    const fees = await extractWithdrawFees(page);
    console.table(fees);

    // await browser.close()
}

run()
