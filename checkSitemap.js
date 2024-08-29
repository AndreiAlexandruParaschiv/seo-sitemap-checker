const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const { sitemapUrl } = require('./config');
const path = require('path');

async function fetchXml(url) {
    try {
        const response = await axios.get(url);
        return response.data;
    } catch (error) {
        console.error(`Error fetching XML from ${url}: ${error.message}`);
        process.exit(1);
    }
}

async function parseXml(xml) {
    const parser = new xml2js.Parser();
    try {
        return await parser.parseStringPromise(xml);
    } catch (error) {
        console.error(`Error parsing XML: ${error.message}`);
        process.exit(1);
    }
}

async function getSitemapsOrUrls(xmlContent) {
    const parsedXml = await parseXml(xmlContent);

    if (parsedXml.sitemapindex && parsedXml.sitemapindex.sitemap) {
        return {
            type: 'index',
            urls: parsedXml.sitemapindex.sitemap.map((sitemap) => sitemap.loc[0])
        };
    } else if (parsedXml.urlset && parsedXml.urlset.url) {
        return {
            type: 'sitemap',
            urls: parsedXml.urlset.url.map((url) => url.loc[0])
        };
    } else {
        throw new Error('Invalid XML format: Neither sitemap index nor sitemap detected');
    }
}

async function checkUrlStatus(url) {
    try {
        const response = await axios.get(url);
        return { url, status: response.status };
    } catch (error) {
        return { url, status: error.response ? error.response.status : 'Network Error' };
    }
}

function generateFilename(baseName, directory) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const parsedUrl = new URL(baseName);
    const domainName = parsedUrl.hostname.replace(/\./g, '_');
    const dirPath = path.join(__dirname, domainName);

    // Create directory if it doesn't exist
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath);
    }

    return path.join(dirPath, `${directory}_${timestamp}.csv`);
}

async function processSitemap(sitemapUrl) {
    const sitemapXml = await fetchXml(sitemapUrl);
    const sitemapUrls = (await getSitemapsOrUrls(sitemapXml)).urls;

    const results = [];
    let successCount = 0;
    let errorCount = 0;

    for (const url of sitemapUrls) {
        const { url: checkedUrl, status } = await checkUrlStatus(url);
        if (status === 200) successCount++;
        else errorCount++;
        results.push({ url: checkedUrl, status });
        console.log(`Checked ${checkedUrl}: ${status}`);
    }

    const csvContent = results
        .map((result) => `${result.url},${result.status}`)
        .join('\n');
    const totalUrls = results.length;
    const summary = `Total URLs Checked:,${totalUrls}\nSuccessful:,${successCount}\nErrors:,${errorCount}`;
    const filename = generateFilename(sitemapUrl, path.basename(sitemapUrl, '.xml'));

    fs.writeFileSync(filename, `URL,Status\n${csvContent}\n${summary}`);
    console.log(`Results saved to ${filename}`);

    return { totalUrls, successCount, errorCount };
}
async function main() {
    const xmlContent = await fetchXml(sitemapUrl);
    const { type, urls } = await getSitemapsOrUrls(xmlContent);

    let totalUrls = 0;
    let successCount = 0;
    let errorCount = 0;

    if (type === 'index') {
        for (const sitemapUrl of urls) {
            console.log(`Processing sitemap: ${sitemapUrl}`);
            const result = await processSitemap(sitemapUrl);
            totalUrls += result.totalUrls;
            successCount += result.successCount;
            errorCount += result.errorCount;
        }
    } else if (type === 'sitemap') {
        const result = await processSitemap(sitemapUrl);
        totalUrls = result.totalUrls;
        successCount = result.successCount;
        errorCount = result.errorCount;
    }

    console.log(`Summary: Verified ${totalUrls} URLs, ${successCount} have 200 status code, ${errorCount} have errors.`);
}

main();

